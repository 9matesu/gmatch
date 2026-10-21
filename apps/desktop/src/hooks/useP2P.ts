import { useEffect, useState, useCallback, useRef } from 'react';
import { OrbitIdentity } from '@orbit/crypto';
import { OrbitP2PNode } from '@orbit/protocol';
import { User, OrbitObject } from '@orbit/shared';
import { saveObject, getObject } from '../utils/storage';
import { OrbitPeerRelay } from '../utils/peer-relay';
import { getApiBaseUrl, getApiWebSocketUrl, orbitFetch, subscribeApiBase } from '../utils/api';
import { mergeRoster } from '../utils/peerRoster';
import { presenceBucket } from '../utils/compare';
import { CHAT_WIPE_SECONDS } from '@orbit/shared';
import { logger } from '../utils/logger';
import { handleSwarmMessage, setSwarmTransport, hydrateLocalObjects, hydrateDurableReplications, announcePeerOnline, PEER_ONLINE_EVENT, announceHeldObjects, setSwarmReceiptIdentity, setSwarmOperationHandler, setSwarmOperationAckHandler, sendSwarmFrame, type SwarmMessage } from '../utils/p2pSwarm';
import { broadcastPresence, fetchPresenceRoster } from '../services/courierPresence';
import { broadcastMeshFrame, onMeshMessage, connectToPeerMesh } from '../utils/courierSignaling';
import { resolveDisplayName } from '../utils/displayName';
import { parseApiTimestamp } from '../utils/timeAgo';
import { mediaFlag, resolveClaimedOwner, descriptorUrlFromBytes } from '../utils/objectDescriptor';

const CHAT_WIPE_MS = CHAT_WIPE_SECONDS * 1000;
const DIRECT_WEBRTC_FANOUT_LIMIT = 3;
/** Cap on frames parked while the relay socket is down. */
const MAX_QUEUED_FRAMES = 200;

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  channel?: 'global_lobby' | 'card_queue' | string;
  replyToId?: string;
  attachmentId?: string;
  attachmentUrl?: string;
  attachmentMime?: string;
  editedAt?: string;
  readByRecipient?: boolean;
  /** Blind-courier DM lifecycle (absent on legacy server-inbox messages). */
  courierStatus?: 'sending' | 'sent' | 'delivered' | 'failed';
  /** Deletion tombstone, ms. The bubble renders "Message deleted". */
  deletedAt?: number;
  /** emoji -> actor orbit ids (sealed courier reactions). */
  reactions?: Record<string, string[]>;
}

export interface P2PSwarmMessage {
  type: 'PRESENCE' | 'MESSAGE' | 'IMAGE_ANNOUNCE' | 'CHAT' | 'STORY_ANNOUNCE';
  user: User;
  payload?: OrbitObject;
  chatMessage?: ChatMessage;
  channel?: string;
  timestamp: number;
  /**
   * Sender stamped by the relay socket (it owns the auth ticket), when the
   * frame arrived through the WS relay. `user.id` alone is client-supplied and
   * must never be treated as proof of who sent an object.
   */
  relayedBy?: string;
}

/**
 * Route one inbound P2P frame.
 *
 * The relay wraps every client-to-client frame in the `SWARM_FRAME` envelope
 * (a bare `type` key could shadow a server-published event, audit A2), so both
 * the swarm byte protocol and the announce shapes arrive wrapped. Swarm shapes
 * go to the byte protocol; everything else is an announcement and carries the
 * relay's proven `relayedBy` when one was stamped.
 */
function routeInboundFrame(
  raw: unknown,
  onSwarm: (msg: SwarmMessage) => void,
  onAnnounce: (msg: P2PSwarmMessage) => void,
): boolean {
  if (!raw || typeof raw !== 'object') return false
  const frame = raw as { type?: unknown; swarm?: unknown; relayedBy?: unknown }
  if (frame.type !== 'SWARM_FRAME' || !frame.swarm || typeof frame.swarm !== 'object') return false
  const inner = frame.swarm as { type?: unknown }
  if (typeof inner.type === 'string' && inner.type.startsWith('SWARM_')) {
    onSwarm(inner as SwarmMessage)
    return true
  }
  const announce = frame.swarm as P2PSwarmMessage
  onAnnounce(typeof frame.relayedBy === 'string' && frame.relayedBy ? { ...announce, relayedBy: frame.relayedBy } : announce)
  return true
}

function arePeersStructurallyEqual(a: User[], b: User[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].display_name !== b[i].display_name ||
      a[i].online !== b[i].online ||
      a[i].score !== b[i].score ||
      a[i].maximum_gooner !== b[i].maximum_gooner ||
      JSON.stringify(a[i].tags || []) !== JSON.stringify(b[i].tags || [])
    ) {
      return false;
    }
    // `last_seen` too, bucketed: the swarm re-stamps it on every PRESENCE
    // frame while `online` stays true, and a frozen timestamp pins the profile
    // modal to Offline even though the peer is plainly in the roster. 15s is
    // well inside the 60s freshness window so no transition is missed.
    if (presenceBucket(a[i].last_seen) !== presenceBucket(b[i].last_seen)) return false;
  }
  return true;
}

// Module-level so it can be referenced from the WebSocket effect without
// ordering issues and keeps a stable identity (not memoized in the hook).
function transmitOverWebSocket(socket: WebSocket | null, queue: P2PSwarmMessage[], msg: P2PSwarmMessage) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logger.log('[ORBIT Network Swarm] WebSocket not open yet. Queuing message for delivery on connect...');
    queue.push(msg);
    // Bounded: a relay that stays down must not grow this forever.
    if (queue.length > MAX_QUEUED_FRAMES) queue.splice(0, queue.length - MAX_QUEUED_FRAMES);
    return;
  }

  // Client-to-client frames ride the relay inside the SWARM_FRAME envelope:
  // a bare `type` key is refused by the node (a forged `feed`/`user_banned`
  // frame must never shadow a server-published event), which is also why peer
  // announcements used to vanish unless a direct WebRTC channel existed.
  const fullPayloadStr = JSON.stringify({ type: 'SWARM_FRAME', swarm: msg });
  const CHUNK_SIZE = 30000;
  if (fullPayloadStr.length > CHUNK_SIZE) {
    const totalChunks = Math.ceil(fullPayloadStr.length / CHUNK_SIZE);
    const transferId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    logger.log(`[ORBIT Network Swarm] Transmitting payload (${(fullPayloadStr.length / 1024).toFixed(1)} KB) in ${totalChunks} chunks (Transfer ID: ${transferId})...`);
    for (let idx = 0; idx < totalChunks; idx++) {
      const chunkData = fullPayloadStr.substring(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
      const chunkMsg = {
        type: 'SWARM_CHUNK',
        transferId,
        index: idx,
        total: totalChunks,
        chunk: chunkData,
        senderId: msg.user.id,
      };
      socket.send(JSON.stringify(chunkMsg));
    }
  } else {
    logger.log('[ORBIT Network Swarm] Transmitting event over WebSocket network to remote peers for item:', msg.payload?.id || msg.type);
    socket.send(fullPayloadStr);
  }
}

export function useP2P(identity: OrbitIdentity | null) {
  const [peers, setPeers] = useState<User[]>([]);
  // v1 replication receipts: this node signs durable-custody attestations for
  // objects it fetches, and validates receipts for objects it serves.
  useEffect(() => {
    setSwarmReceiptIdentity(identity
      ? { orbitId: identity.orbitId, publicKeyHex: identity.publicKeyHex, privateKeyHex: identity.privateKeyHex }
      : null);
    return () => { setSwarmReceiptIdentity(null); };
  }, [identity]);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [localDisplayName, setLocalDisplayName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem('orbit_display_name') || ''; } catch { return ''; }
  });
  const [localTags, setLocalTags] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = JSON.parse(localStorage.getItem('orbit_tags') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('orbit_chat_messages');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [p2pItems, setP2pItems] = useState<OrbitObject[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('orbit_p2p_gallery');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const peerMapRef = useRef<Map<string, User>>(new Map());
  // Committed API-base generation: bumped on every seamless world switch so
  // the connection effect below re-runs (cleanup closes the old socket, the
  // new run dials the new base). The app shell never remounts.
  const [baseGen, setBaseGen] = useState(0);
  const lastBaseRef = useRef<string>('');
  useEffect(() => subscribeApiBase(() => setBaseGen((g) => g + 1)), []);
  const nodeRef = useRef<OrbitP2PNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const relayRef = useRef<OrbitPeerRelay | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const chunkBuffersRef = useRef<Map<string, { total: number; chunks: Map<number, string>; startedAt: number }>>(new Map());
  const sendHeartbeatRef = useRef<() => void>(() => {});
  const historyLoadedRef = useRef(false);

  const selfUserRef = useRef<User>({
    id: identity?.orbitId || '',
    publicKey: identity?.publicKeyHex || '',
    encryptionPubKey: identity?.encryptionPubHex,
    createdAt: new Date().toISOString(),
    display_name: localDisplayName || '',
    tags: localTags.length > 0 ? localTags : undefined,
    online: true,
    last_seen: new Date().toISOString(),
    score: 100,
  });

  useEffect(() => {
    if (!identity) return;
    let currentName = localDisplayName;
    try {
      const stored = localStorage.getItem('orbit_display_name');
      if (stored) currentName = stored;
    } catch {}
    let currentTags = localTags;
    try {
      const storedTags = JSON.parse(localStorage.getItem('orbit_tags') || '[]');
      if (Array.isArray(storedTags) && storedTags.length > 0) currentTags = storedTags;
    } catch {}
    selfUserRef.current = {
      id: identity.orbitId,
      publicKey: identity.publicKeyHex,
      encryptionPubKey: identity.encryptionPubHex,
      createdAt: selfUserRef.current.createdAt || new Date().toISOString(),
      display_name: currentName || '',
      tags: currentTags.length > 0 ? currentTags : undefined,
      online: true,
      last_seen: new Date().toISOString(),
      score: 100,
    };
    setTimeout(() => sendHeartbeatRef.current?.(), 0);
  }, [identity, localDisplayName, localTags]);

  useEffect(() => {
    const handleProfileUpdate = (e: any) => {
      const newName = e?.detail?.displayName || (typeof window !== 'undefined' ? localStorage.getItem('orbit_display_name') : '') || '';
      if (newName && newName !== localDisplayName) {
        setLocalDisplayName(newName);
      }
      const newTags = e?.detail?.tags;
      let tagsToSet: string[] | null = Array.isArray(newTags) ? newTags : null;
      if (tagsToSet === null && typeof window !== 'undefined') {
        try {
          const raw = JSON.parse(localStorage.getItem('orbit_tags') || '[]');
          if (Array.isArray(raw)) tagsToSet = raw;
        } catch {}
      }
      if (tagsToSet && JSON.stringify(tagsToSet) !== JSON.stringify(localTags)) {
        setLocalTags(tagsToSet);
      }
    };
    window.addEventListener('orbit_profile_updated', handleProfileUpdate);
    window.addEventListener('storage', handleProfileUpdate);
    return () => {
      window.removeEventListener('orbit_profile_updated', handleProfileUpdate);
      window.removeEventListener('storage', handleProfileUpdate);
    };
  }, [localDisplayName, localTags]);

  const updateSelfProfile = useCallback((name: string) => {
    try { localStorage.setItem('orbit_display_name', name); } catch {}
    setLocalDisplayName(name);
    try {
      window.dispatchEvent(new CustomEvent('orbit_profile_updated', { detail: { displayName: name, tags: localTags } }));
    } catch {}
  }, [localTags]);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    // World switch (not first mount): the roster belongs to the previous
    // server. Mark everyone unconfirmed-offline; the new world's roster
    // refresh re-confirms who is actually there. Memory is preserved.
    const runBase = getApiBaseUrl();
    if (lastBaseRef.current && lastBaseRef.current !== runBase) {
      for (const [id, u] of peerMapRef.current) peerMapRef.current.set(id, { ...u, online: false });
    }
    lastBaseRef.current = runBase;

    // 1. Initialize PeerJS WebRTC Relay Engine
    const peerRelay = new OrbitPeerRelay(identity.orbitId);
    relayRef.current = peerRelay;

    peerRelay.onMessage = (msg, fromPeerId) => {
      logger.log('[ORBIT PeerJS Swarm] Received direct WebRTC DataChannel message from:', fromPeerId, 'Type:', msg.type);
      processSwarmMessage(msg as P2PSwarmMessage);
    };

    // 2. Initialize P2P Node
    const node = new OrbitP2PNode(identity);
    nodeRef.current = node;

    // 3. Initialize Cross-Tab Broadcast Channel Swarm
    const channel = new BroadcastChannel('orbit_p2p_swarm');
    channelRef.current = channel;
    const selfUser = selfUserRef.current;

    // Swarm transport wire: allow requestSwarmObject / handleSwarmMessage to
    // fan out WANT and CHUNK frames over BroadcastChannel (same-device tabs),
    // WebSocket relay (network peers), and direct WebRTC DataChannel mesh.
    setSwarmTransport((msg: SwarmMessage) => {
      try { channel.postMessage({ type: 'SWARM_FRAME', swarm: msg }); } catch {}
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SWARM_FRAME', swarm: msg }));
      }
      broadcastMeshFrame(JSON.stringify({ type: 'SWARM_FRAME', swarm: msg }));
    });

    const unsubMesh = onMeshMessage((data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (!routeInboundFrame(parsed, (m) => { void handleSwarmMessage(m); }, processSwarmMessage)) {
          processSwarmMessage(parsed as P2PSwarmMessage);
        }
      } catch {}
    });
    // Local-first seeding: reload persisted bytes into RAM so this client
    // keeps retransmitting its own posts after a restart (packaged exe).
    // A peer that just came online may hold bytes we failed to fetch, and our
    // copy may be one it wants. Announce what we hold — throttled, because a
    // flapping roster must not become a HAVE storm.
    let lastHaveAt = 0
    const announceHave = () => {
      const now = Date.now()
      if (now - lastHaveAt < 10_000) return
      lastHaveAt = now
      announceHeldObjects()
    }

    void hydrateLocalObjects()
      .then((count) => {
        // On the boot timeline: hydration is the one startup step that grows
        // with the vault, so its end (and object count) is the evidence a
        // media-bound spike needs.
        window.gmatch?.bootMark?.(`swarm:hydrated:${count}`)
        announceHave()
      })
      .catch(() => {})
    // Reload durable-replication receipts recorded before this boot, so
    // "peer-confirmed durable" evidence survives restarts (L2).
    void hydrateDurableReplications().catch(() => {})

    // Phase 4: resume swarm transfers that failed while a seeder was offline.
    // Bytes only land after hash verification (requestSwarmObject).
    const resumeTransfers = () => {
      announceHave()
      void import('../utils/pendingTransfers').then(({ resumePendingTransfers }) =>
        resumePendingTransfers((id, hash) =>
          import('../utils/p2pSwarm').then(({ requestSwarmObject }) =>
            requestSwarmObject(id, 5000, { expectedHash: hash ?? undefined }),
          ),
        ),
      ).catch(() => {})
    }
    resumeTransfers()
    window.addEventListener(PEER_ONLINE_EVENT, resumeTransfers);

    // L4 transport: signed social operations travel over the swarm channel.
    // Inbound frames are re-validated + authorized before the durable log
    // accepts them; outbound waves hand every pending operation to the
    // network on boot and whenever a peer comes online. Broadcast is
    // fire-and-forget ('sending', never 'delivered' — proof comes later).
    let teardownOperations: (() => void) | null = null
    void import('../services/socialOperationLog').then(async ({ sharedSocialOperationLog }) => {
      const { acceptInboundOperation, applyOperationAck, broadcastPendingOperations } = await import('../services/socialOpTransport')
      const operationLog = sharedSocialOperationLog()
      // Inbound: validate + authorize + durable append, then ACK the sender
      // (a duplicate is already durable here, so it is acked too). Never ack a
      // rejection — the sender keeps retrying and re-validating.
      setSwarmOperationHandler(async (operation) => {
        const outcome = await acceptInboundOperation(operationLog, operation)
        if (outcome !== 'accepted' && outcome !== 'duplicate') return
        const op = operation as { operationId?: unknown; actorId?: unknown }
        if (typeof op?.operationId !== 'string' || typeof op?.actorId !== 'string') return
        sendSwarmFrame({ type: 'SWARM_OP_ACK', operationId: op.operationId, actorId: op.actorId })
      })
      // Outbound acks advance our own entries to 'delivered' — the only path
      // that does, since a broadcast is fire-and-forget.
      setSwarmOperationAckHandler((ack) => {
        void applyOperationAck(operationLog, ack).catch(() => {})
      })
      const broadcastOperations = () => {
        void broadcastPendingOperations(operationLog, (operation) => {
          sendSwarmFrame({ type: 'SWARM_OP', operation })
        }).catch(() => {})
      }
      broadcastOperations()
      window.addEventListener(PEER_ONLINE_EVENT, broadcastOperations)
      teardownOperations = () => {
        window.removeEventListener(PEER_ONLINE_EVENT, broadcastOperations)
        setSwarmOperationHandler(null)
        setSwarmOperationAckHandler(null)
      }
    }).catch(() => { /* operation transport unavailable this session */ })

    // Load saved known peers from storage on mount. Entries unseen for over
    // 24h are dropped so ancient ghosts never resurrect; the rest hydrate as
    // offline until the roster/swarm confirms them fresh.
    try {
      const savedPeers = localStorage.getItem('orbit_p2p_known_peers');
      if (savedPeers) {
        const parsed: User[] = JSON.parse(savedPeers);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const p of parsed) {
          if (!p || p.id === selfUser.id) continue;
          const t = p.last_seen ? new Date(p.last_seen).getTime() : 0;
          if (t > 0 && t < cutoff) continue;
          peerMapRef.current.set(p.id, { ...p, online: false });
        }
      }
    } catch {}

    const updatePeersList = () => {
      const allPeers = Array.from(peerMapRef.current.values());
      setPeers(prev => arePeersStructurallyEqual(prev, allPeers) ? prev : allPeers);
      try {
        const onlineOrKnown = allPeers.slice(0, 30);
        localStorage.setItem('orbit_p2p_known_peers', JSON.stringify(onlineOrKnown));
      } catch {}
    };

    updatePeersList();

    const processSwarmMessage = (data: P2PSwarmMessage) => {
      const currentSelf = selfUserRef.current;
      if (!data || !data.user || data.user.id === currentSelf.id) return;

      logger.log('[ORBIT Network Swarm] Discovered remote peer:', data.user.display_name || data.user.id, 'Type:', data.type);

      const prevSeen = peerMapRef.current.get(data.user.id);
      peerMapRef.current.set(data.user.id, {
        ...data.user,
        online: true,
        last_seen: new Date().toISOString(),
      });
      updatePeersList();
      // Offline seeder coming back: wake failed P2P tiles so they retry.
      if (!prevSeen || !prevSeen.online) announcePeerOnline(data.user.id);

      if (data.type === 'PRESENCE') {
        logger.log('[ORBIT Network Swarm] Remote peer online presence confirmed:', data.user.display_name || data.user.id);
      } else if (data.type === 'STORY_ANNOUNCE') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orbit-story-announce'))
        }
      } else if (data.type === 'CHAT' && data.chatMessage) {
        const chan = data.chatMessage.channel || data.channel || 'global_lobby';
        const msgWithChan: ChatMessage = { ...data.chatMessage, channel: chan };
        logger.log('[ORBIT Chat] Cross-tab chat message:', msgWithChan.text.slice(0, 30));
        setChatMessages(prev => {
          if (prev.some(m => m.id === msgWithChan.id)) return prev;
          return [...prev, msgWithChan];
        });
      } else if ((data.type === 'IMAGE_ANNOUNCE' || data.type === 'MESSAGE') && data.payload) {
        const newItem = data.payload;
        logger.log('[ORBIT Network Swarm] Received IMAGE_ANNOUNCE payload from remote peer:', data.user.display_name || data.user.id, 'Item ID:', newItem.id, 'DataURL Length:', newItem.content_url?.length || 0);

        // An announcement DESCRIBES an object; it never carries its bytes. The
        // provider link is stored as `source_url` — separate from `data` — and
        // the claimed owner is only accepted when the envelope's sender proves
        // it (a relayed claim stays unverified instead of impersonating).
        const claim = resolveClaimedOwner((newItem as any).owner_id, data.relayedBy || data.user?.id)

        if (newItem.content_url) {
          const sourceUrl = newItem.content_url
          void (async () => {
            try {
              const existing = await getObject(newItem.id)
              // Real bytes already here: never replace them with a link.
              if (
                existing?.data &&
                existing.data.byteLength > 0 &&
                !descriptorUrlFromBytes(existing.data)
              ) {
                return
              }
              await saveObject({
                id: newItem.id,
                name: newItem.id,
                mime_type: newItem.mime_type || 'image/jpeg',
                size_bytes: newItem.size_bytes || 0,
                owner_id: claim.owner_id || (data.user?.id ?? ''),
                owner_verified: claim.owner_verified,
                sender_pubkey: newItem.sender_pubkey || '',
                sender_enc_pubkey: newItem.sender_enc_pubkey || '',
                created_at: newItem.created_at || new Date().toISOString(),
                data: new ArrayBuffer(0),
                source_url: sourceUrl,
                is_public: mediaFlag((newItem as any).is_public),
                is_story: mediaFlag((newItem as any).is_story),
                is_chat: mediaFlag((newItem as any).is_chat),
                is_avatar: mediaFlag((newItem as any).is_avatar),
                caption: (newItem as any).caption || (newItem as any).post_caption || '',
                tags: (newItem as any).tags || [],
                author_name: (newItem as any).author_name || (newItem as any).sender_name || '',
                location: (newItem as any).location || '',
                comments: (newItem as any).comments || [],
                likes_count: (newItem as any).likes_count || (newItem as any).like_count || 0,
                comment_count: (newItem as any).comment_count || 0,
              })
            } catch {
              /* storage unavailable (tests/SSR/quota) */
            }
          })()
        }

        setP2pItems((prev) => {
          if (prev.some((item) => item.id === newItem.id)) return prev;
          const updated = [{ ...newItem, owner_verified: claim.owner_verified }, ...prev];
          try {
            const safeItems = updated.slice(0, 50);
            localStorage.setItem('orbit_p2p_gallery', JSON.stringify(safeItems));
          } catch (e) {
            logger.warn('[ORBIT P2P] LocalStorage save quota limit:', e);
          }
          return updated;
        });
      }
    };

    // 3. Setup WebSocket relay via the API worker
    const API_WS = getApiWebSocketUrl('/api/ws');
    let courierOnlyWs = /gmatch-wcz1\.onrender\.com/i.test(API_WS);
    // Hostname alone misses every OTHER blind courier (a friend's node set
    // to SITE_SERVICES=mail,turn and joined via a server URL would get no
    // presence at all). The node self-declares: /api/health answers
    // mode:'courier' exactly when the legacy swarm WS is retired. On the
    // flip side a full node stays 'legacy' and keeps /api/users/online —
    // so this changes nothing for regular hosts.
    void fetch(`${getApiBaseUrl()}/api/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { mode?: string } | null) => {
        if (h?.mode !== 'courier' || courierOnlyWs) return;
        courierOnlyWs = true;
        // First beacon + roster pull now, not at the next 60s tick.
        sendHeartbeat();
        pullRoster();
      })
      .catch(() => { /* offline: legacy behaviour stands */ });

    // The WS relay only serves authenticated identities: fetch a one-time
    // ws-ticket and present it right after the socket opens. Heartbeat and any
    // queued swarm messages are only emitted once auth is in flight, so an
    // anonymous socket never transmits.
    const authenticateWs = async () => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      let ticket: string | null = null;
      try {
        const res = await orbitFetch('/api/ws-ticket', { method: 'POST' }, identity);
        const json = await res.json().catch(() => null);
        ticket = json && typeof json.ticket === 'string' ? json.ticket : null;
      } catch {}
      if (socket.readyState !== WebSocket.OPEN) return;
      if (ticket) {
        socket.send(JSON.stringify({ type: 'auth', ticket }));
      }
      sendHeartbeatRef.current();
      if (queuedMessagesRef.current.length > 0) {
        logger.log(`[ORBIT Network Swarm] Flushing ${queuedMessagesRef.current.length} queued messages...`);
        while (queuedMessagesRef.current.length > 0) {
          const pendingMsg = queuedMessagesRef.current.shift();
          if (pendingMsg) transmitOverWebSocket(wsRef.current, queuedMessagesRef.current, pendingMsg);
        }
      }
    };

    let wsReconnectDelay = 1000;
    const MAX_WS_DELAY = 30000;
    // Install-loop guard: a stale loopback base (dead 127.0.0.1:8790) must
    // not reconnect forever. After 8 straight failures on loopback, park
    // the socket (5min) instead of hammering the port.
    let wsFailCount = 0;
    let wsParked = false;
    const isLoopbackWs = /127\.0\.0\.1|localhost|::1/.test(API_WS);
    const scheduleReconnect = () => {
      if (cancelled) return;
      if (isLoopbackWs && wsFailCount >= 8) {
        if (!wsParked) {
          wsParked = true;
          logger.warn('[ORBIT Network Swarm] Loopback relay unreachable — parking reconnects (stale host-mode override?).');
        }
        setTimeout(() => { if (!cancelled) { wsFailCount = 0; wsParked = false; connectWebSocket(); } }, 5 * 60 * 1000);
        return;
      }
      setTimeout(connectWebSocket, wsReconnectDelay);
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, MAX_WS_DELAY);
    };

    const connectWebSocket = () => {
       if (cancelled || courierOnlyWs) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      logger.log('[ORBIT Network Swarm] Connecting to WebSocket relay:', API_WS, 'Peer ID:', selfUser.id);
      try {
        const socket = new WebSocket(API_WS);
        wsRef.current = socket;

        socket.onopen = () => {
          logger.log('[ORBIT Network Swarm] WebSocket swarm relay connected via:', API_WS);
          wsReconnectDelay = 1000;
          wsFailCount = 0;
          wsParked = false;
          setIsWsConnected(true);
          void authenticateWs();
        };

        socket.onmessage = (event) => {
          try {
            const rawData = JSON.parse(event.data);
            if (!rawData) return;

            if (routeInboundFrame(rawData, (m) => { void handleSwarmMessage(m); }, processSwarmMessage)) {
              return;
            }

            if (rawData.type === 'PROFILE' && rawData.user && rawData.user.id) {
              const profile = rawData.user;
              const existing = peerMapRef.current.get(profile.id);
              if (existing) {
                peerMapRef.current.set(profile.id, {
                  ...existing,
                  ...profile,
                  online: true,
                  last_seen: new Date().toISOString(),
                });
                updatePeersList();
              }
              if (typeof window !== 'undefined') {
                try { window.dispatchEvent(new CustomEvent('orbit-profilesync')); } catch {}
              }
              return;
            }

            if (rawData.type === 'SWARM_CHUNK') {
              const { transferId, index, total, chunk, senderId } = rawData;
              const currentSelf = selfUserRef.current;
              if (senderId === currentSelf.id) return;

              // TTL sweep: clean transfers older than 2 minutes
              const now = Date.now()
              for (const [tid, buf] of chunkBuffersRef.current) {
                if (now - buf.startedAt > 120_000) {
                  chunkBuffersRef.current.delete(tid)
                }
              }

              logger.log(`[ORBIT Network Swarm] Received chunk ${index + 1}/${total} for transfer ${transferId}`);
              if (!chunkBuffersRef.current.has(transferId)) {
                chunkBuffersRef.current.set(transferId, { total, chunks: new Map(), startedAt: now });
              }
              const buf = chunkBuffersRef.current.get(transferId)!;
              buf.chunks.set(index, chunk);

              if (buf.chunks.size === total) {
                let fullStr = '';
                for (let i = 0; i < total; i++) {
                  fullStr += buf.chunks.get(i) || '';
                }
                chunkBuffersRef.current.delete(transferId);
                logger.log(`[ORBIT Network Swarm] Reassembled transfer ${transferId} (${(fullStr.length / 1024).toFixed(1)} KB)`);
                const parsed = JSON.parse(fullStr);
                if (!routeInboundFrame(parsed, (m) => { void handleSwarmMessage(m); }, processSwarmMessage)) {
                  // Legacy peer: an announcement sent unwrapped.
                  processSwarmMessage(parsed as P2PSwarmMessage);
                }
              }
              return;
            }

            if (rawData.type === 'lobby-chat' && rawData.action === 'new' && rawData.message && rawData.message.id) {
              const m = rawData.message as { id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel?: string };
              const chan = m.channel || rawData.channel || 'global_lobby';
              setChatMessages(prev => {
                if (prev.some(x => x.id === m.id)) return prev;
                return [...prev, {
                  id: m.id,
                  senderId: m.sender_id,
                   senderName: m.sender_name?.trim() || 'Unknown User',
                  text: m.body,
                  timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
                  channel: chan,
                }].sort((a, b) => a.timestamp - b.timestamp);
              });
              return;
            }

            const data: P2PSwarmMessage = rawData;
            processSwarmMessage(data);
          } catch {
            // Ignore non-JSON frames
          }
        };

        socket.onerror = (err) => {
          logger.warn('[ORBIT Network Swarm] WebSocket error:', err);
          setIsWsConnected(false);
        };

        socket.onclose = () => {
          wsFailCount += 1;
          logger.log(`[ORBIT Network Swarm] WebSocket connection closed, reconnecting in ${wsReconnectDelay}ms...`);
          setIsWsConnected(false);
          scheduleReconnect();
        };
      } catch (e) {
        wsFailCount += 1;
        logger.warn('[ORBIT Network Swarm] WebSocket init error:', e);
        scheduleReconnect();
      }
    };

    connectWebSocket();

    // 4. Broadcast presence heartbeat over local BroadcastChannel, WebSocket network, & PeerJS DataChannels
    const sendHeartbeat = () => {
      // Skip presence broadcasts from hidden tabs: browsers throttle background
      // timers anyway, and hidden tabs should not contribute swarm noise.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const currentSelf = selfUserRef.current;
      const msg: P2PSwarmMessage = {
        type: 'PRESENCE',
        user: currentSelf,
        timestamp: Date.now(),
      };
      try { channel.postMessage(msg); } catch {}

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        transmitOverWebSocket(wsRef.current, queuedMessagesRef.current, msg);
      } else if (courierOnlyWs && identity) {
        void broadcastPresence(identity, { displayName: currentSelf.display_name, pfpUrl: currentSelf.pfp_url });
      }

      // NOTE: No direct WebRTC connections on heartbeat — causes RTCPeerConnection exhaustion.
      // Presence is broadcast via WebSocket and BroadcastChannel only.
      // Direct connections are established only for actual image transfers in sendP2PItem.
    };
    sendHeartbeatRef.current = sendHeartbeat;

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60_000);

    // 4b. Discovery roster (plan P2.2): seed the peer map immediately from
    // the server's current online set instead of waiting passively for the
    // next swarm event. Refresh rides the same 60s cadence as presence.
    const pullRoster = () => {
      ;(courierOnlyWs
        ? fetchPresenceRoster(selfUserRef.current.id).then((users) => ({ users }))
        : orbitFetch('/api/users/online', {}, identity).then((r) => (r.ok ? r.json() : { users: [] })).catch(() => ({ users: [] })))
        .then((res: any) => (res && 'users' in res ? res : (res && res.ok ? res.json() : { users: [] })))
        .then(({ users }: { users?: User[] }) => {
          // NOTE: an empty roster is a valid signal (everyone left) — it
          // still runs so leavers decay to offline instead of lingering.
          if (!Array.isArray(users)) return
          const wasOnline = new Set(
            [...peerMapRef.current.entries()]
              .filter(([, p]) => p?.online)
              .map(([id]) => id),
          )
          if (mergeRoster(peerMapRef.current, users, selfUserRef.current.id)) updatePeersList()
          // Freshly-online roster members may be seeders for failed P2P
          // tiles — wake them to retry.
          for (const u of users) {
            if (u?.id && u.id !== selfUserRef.current.id && !wasOnline.has(u.id)) {
              announcePeerOnline(u.id)
              const pubKey = u.publicKey || (u as any).public_key
              const encKey = u.encryptionPubKey || (u as any).encryption_pub_key
              if (courierOnlyWs && pubKey && encKey) {
                void connectToPeerMesh({ id: u.id, public_key: pubKey, encryption_pub_key: encKey }, identity).catch(() => {})
              }
            }
          }
        })
        .catch(() => {})
    }
    pullRoster()
    const rosterInterval = setInterval(pullRoster, 60_000)

    // 4c. Foreground burst: timers are throttled while hidden and heartbeats
    // are skipped, so on return immediately re-announce + re-pull instead of
    // sitting ghost-offline until the next 60s tick.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        sendHeartbeat()
        pullRoster()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible)
    }

    // 5. Handle incoming local tab P2P swarm events
    channel.onmessage = (event: MessageEvent<P2PSwarmMessage & { swarm?: SwarmMessage; type: string }>) => {
      const raw = event.data as unknown as { swarm?: SwarmMessage; type?: string };
      if (raw && raw.swarm && typeof raw.swarm === 'object') {
        void handleSwarmMessage(raw.swarm);
        return;
      }
      const data = event.data as P2PSwarmMessage;
      if (!data || !data.user) return;

      const prevLocal = peerMapRef.current.get(data.user.id);
      peerMapRef.current.set(data.user.id, {
        ...data.user,
        online: true,
        last_seen: new Date().toISOString(),
      });
      updatePeersList();
      if (!prevLocal || !prevLocal.online) announcePeerOnline(data.user.id);

      if (data.type === 'PRESENCE') {
        // Do not echo every tab's presence back into BroadcastChannel and the
        // websocket. The server heartbeat is periodic and authoritative.
      } else if (data.type === 'CHAT' && data.chatMessage) {
        const chan = data.chatMessage.channel || data.channel || 'global_lobby';
        const msgWithChan: ChatMessage = { ...data.chatMessage, channel: chan };
        setChatMessages(prev => {
          if (prev.some(m => m.id === msgWithChan.id)) return prev;
          return [...prev, msgWithChan];
        });
      } else if (data.type === 'STORY_ANNOUNCE') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orbit-story-announce'))
        }
      } else if ((data.type === 'IMAGE_ANNOUNCE' || data.type === 'MESSAGE') && data.payload) {
        const newItem = data.payload;
        logger.log('[ORBIT Local Swarm] Received local tab swarm event:', data.type, 'from:', data.user.display_name || data.user.id, 'item:', newItem.id);
        setP2pItems((prev) => {
          if (prev.some((item) => item.id === newItem.id)) return prev;
          const updated = [newItem, ...prev];
          try {
            const safeItems = updated.slice(0, 50).map(i => {
              if (i.content_url && i.content_url.length > 100000) {
                return { ...i, content_url: '' };
              }
              return i;
            });
            localStorage.setItem('orbit_p2p_gallery', JSON.stringify(safeItems));
          } catch (e) {
            logger.warn('[ORBIT P2P] LocalStorage save quota limit:', e);
          }
          return updated;
        });
      }
    };

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(rosterInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
      }
      channel.close();
      channelRef.current = null;
      setSwarmTransport(null);
      window.removeEventListener(PEER_ONLINE_EVENT, resumeTransfers);
      if (teardownOperations) teardownOperations();
      setSwarmOperationHandler(null);
      unsubMesh();
      if (wsRef.current) {
        wsRef.current.close();
      }
      relayRef.current?.destroy();
      relayRef.current = null;
      nodeRef.current = null;
    };
  }, [identity, baseGen]);

  const loadLobbyHistory = useCallback(async () => {
    if (!identity) return
    try {
      const res = await orbitFetch('/api/lobby/chat', { method: 'GET' }, identity)
      if (!res.ok) return
      const data = await res.json() as { messages?: Array<{ id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel?: string }> }
      if (!Array.isArray(data.messages)) return
      const mapped: ChatMessage[] = data.messages
        .filter((m) => m && m.id && m.body)
        .map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name?.trim() || 'Unknown User',
          text: m.body,
          timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
          channel: m.channel || 'global_lobby',
        }))
      setChatMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]))
        for (const message of mapped) byId.set(message.id, message)
        return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp).slice(-100)
      })
    } catch {}
  }, [identity])

  useEffect(() => {
    void loadLobbyHistory()
    const onVisible = () => { if (document.visibilityState === 'visible') void loadLobbyHistory() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadLobbyHistory])

  const queuedMessagesRef = useRef<P2PSwarmMessage[]>([]);

  const sendP2PItem = useCallback(
    (item: OrbitObject) => {
      if (!identity) return;

      logger.log('[ORBIT P2P] sendP2PItem initiated for:', item.id, 'size:', item.size_bytes, 'mime:', item.mime_type);

      // Add to local items state & storage immediately
      setP2pItems((prev) => {
        if (prev.some((existing) => existing.id === item.id)) return prev;
        const updated = [item, ...prev];
        try {
          const safeItems = updated.slice(0, 50);
          localStorage.setItem('orbit_p2p_gallery', JSON.stringify(safeItems));
        } catch (e) {
          logger.warn('[ORBIT P2P] LocalStorage save quota limit:', e);
        }
        return updated;
      });

      if (item.content_url) {
        const sourceUrl = item.content_url
        void (async () => {
          try {
            const existing = await getObject(item.id)
            // The real bytes are already forged and durable. Publishing must
            // never replace them with the link that points at them.
            if (
              existing?.data &&
              existing.data.byteLength > 0 &&
              !descriptorUrlFromBytes(existing.data)
            ) {
              return
            }
            await saveObject({
              id: item.id,
              name: item.id,
              mime_type: item.mime_type || 'image/jpeg',
              size_bytes: item.size_bytes || 0,
              owner_id: item.owner_id || identity.orbitId,
              owner_verified: true,
              sender_pubkey: identity.publicKeyHex,
              sender_enc_pubkey: identity.encryptionPubHex || '',
              created_at: item.created_at || new Date().toISOString(),
              data: new ArrayBuffer(0),
              source_url: sourceUrl,
              is_public: mediaFlag((item as any).is_public),
              is_story: mediaFlag((item as any).is_story),
              is_chat: mediaFlag((item as any).is_chat),
              is_avatar: mediaFlag((item as any).is_avatar),
            })
          } catch {
            /* storage unavailable (tests/SSR/quota) */
          }
        })()
      }

      const selfUser = selfUserRef.current;

      const msg: P2PSwarmMessage = {
        type: 'IMAGE_ANNOUNCE',
        user: selfUser,
        payload: item,
        timestamp: Date.now(),
      };

      // Broadcast to local tab BroadcastChannel (reuse persistent channel)
      try {
        if (channelRef.current) {
          channelRef.current.postMessage(msg);
        } else {
          const fallback = new BroadcastChannel('orbit_p2p_swarm');
          fallback.postMessage(msg);
          fallback.close();
        }
      } catch {}

      // Broadcast over network WebSocket to remote swarm peers with chunking/queuing
      transmitOverWebSocket(wsRef.current, queuedMessagesRef.current, msg);
      broadcastMeshFrame(JSON.stringify(msg));

      // Broadcast direct WebRTC DataChannel payloads to all discovered peers via PeerJS
      if (relayRef.current) {
        const directPeers = Array.from(peerMapRef.current.values())
          .filter((peerUser) => peerUser.id !== selfUser.id && peerUser.online && relayRef.current?.canDial(peerUser.id))
          .sort((a, b) => Date.parse(b.last_seen || '') - Date.parse(a.last_seen || ''))
          .slice(0, DIRECT_WEBRTC_FANOUT_LIMIT);
        for (const peerUser of directPeers) {
          logger.log('[ORBIT PeerJS Swarm] Transmitting direct WebRTC P2P DataChannel payload to peer:', peerUser.display_name || peerUser.id);
          relayRef.current.connectAndSend(peerUser.id, msg);
        }
      }
    },
    [identity]
  );  const sendChatMessage = useCallback((text: string, channel: string = 'global_lobby') => {
    const selfUser = selfUserRef.current;
    if (!selfUser) return;
    const chatMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: selfUser.id,
      // The lobby is a PUBLIC channel, so this name is what every other client
      // renders — resolving it through the shared helper (local storage first)
      // keeps it identical to what the chat hub shows for the same person.
      senderName: resolveDisplayName({
        selfId: selfUser.id,
        senderId: selfUser.id,
        roster: peerMapRef.current,
        fallback: selfUser.display_name,
      }),
      text,
      timestamp: Date.now(),
      channel,
    };
    const msg: P2PSwarmMessage = {
      type: 'CHAT',
      user: selfUser,
      chatMessage: chatMsg,
      channel,
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, chatMsg]);

    try {
      if (channelRef.current) {
        channelRef.current.postMessage(msg);
      } else {
        const fallback = new BroadcastChannel('orbit_p2p_swarm');
        fallback.postMessage(msg);
        fallback.close();
      }
    } catch {}

    transmitOverWebSocket(wsRef.current, queuedMessagesRef.current, msg);
    broadcastMeshFrame(JSON.stringify(msg));

    if (relayRef.current) {
      const directPeers = Array.from(peerMapRef.current.values())
        .filter((peerUser) => peerUser.id !== selfUser.id && peerUser.online && relayRef.current?.canDial(peerUser.id))
        .sort((a, b) => Date.parse(b.last_seen || '') - Date.parse(a.last_seen || ''))
        .slice(0, DIRECT_WEBRTC_FANOUT_LIMIT);
      for (const peerUser of directPeers) {
        relayRef.current.connectAndSend(peerUser.id, msg as any);
      }
    }

    // Persist to the server so the row is the source of truth for a page reload
    // or a late joiner. Fire-and-forget: if it fails we still have the local
    // P2P copy, and the WS push to the lobby room keeps other tabs in sync.
    if (identity) {
      void orbitFetch('/api/lobby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chatMsg.id, body: chatMsg.text, channel }),
      }, identity).catch(() => {});
    }
  }, [identity]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      try {
        const safe = chatMessages.slice(-100);
        localStorage.setItem('orbit_chat_messages', JSON.stringify(safe));
      } catch {}
    }
  }, [chatMessages]);

  return {
    peers,
    p2pItems,
    sendP2PItem,
    sendChatMessage,
    chatMessages,
    isWsConnected,
    updateSelfProfile,
  };
}
