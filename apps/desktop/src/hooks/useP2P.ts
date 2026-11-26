import { useEffect, useState, useCallback, useRef } from 'react';
import { OrbitIdentity } from '@orbit/crypto';
import { User, OrbitObject, generateFallbackName } from '@orbit/shared';
import { parseBareSwarmAnnounce, parseSwarmEnvelope, type SwarmAnnounce, type SwarmMessage } from '@orbit/protocol';
import { saveObject, getObject } from '../utils/storage';
import { getApiBaseUrl, getApiWebSocketUrl, isCourierHost, orbitFetch, subscribeApiBase } from '../utils/api';
import { PeerRoster } from '../utils/peerRoster';
import { areUsersStructurallyEqual } from '../utils/compare';
import { logger } from '../utils/logger';
import { handleSwarmMessage, setSwarmTransport, hydrateLocalObjects, hydrateDurableReplications, announcePeerOnline, PEER_ONLINE_EVENT, announceHeldObjects, setSwarmReceiptIdentity, setSwarmOperationHandler, setSwarmOperationAckHandler, sendSwarmFrame } from '../utils/p2pSwarm';
import { broadcastPresence, fetchPresenceRosterFrom } from '../services/courierPresence';
import { startMesh, meshPeerAsUser, type MeshHandle } from '../utils/mesh/mesh';
import { readSettings } from './useSettings';
import { knownNodes, rememberKnownNode, rememberPeerNode } from '../utils/peerNodes';
import { broadcastMeshFrame, onMeshMessage, connectToPeerMesh, setMeshIceFailureHandler, MESH_BACKPRESSURE_HIGH_BYTES } from '../utils/courierSignaling';
import { createTransportRegistry } from '../utils/transportState';
import { resolveDisplayName } from '../utils/displayName';
import { parseApiTimestamp } from '../utils/timeAgo';
import { mediaFlag, resolveClaimedOwner, descriptorUrlFromBytes } from '../utils/objectDescriptor';

/** Cap on frames parked while the relay socket is down. */
const MAX_QUEUED_FRAMES = 200;
/** How many nodes one roster round may read the presence mailbox of. */
const MAX_ROSTER_NODES_PER_ROUND = 8;
/** How often the transport-selection tick runs direct retries & deadlines. */
const TRANSPORT_TICK_MS = 4000;

/**
 * Per-peer transport-selection registry (roadmap P0): idle / connecting-direct
 * / direct / relay / failed. The swarm itself keeps fanning frames over every
 * wired pipe — this layer makes WHICH path is real observable and keeps the
 * relay session alive while direct attempts retry with backoff.
 */
const swarmTransportRegistry = createTransportRegistry();

/** Human label for the peer list: what path is this peer's traffic really
 *  taking? Null = nothing worth showing yet (idle/connecting). */
export function swarmTransportLabel(peerId: string): string | null {
  switch (swarmTransportRegistry.phaseFor(peerId)) {
    case 'direct': return 'P2P direto'
    case 'relay': return 'relay via nó (NAT)'
    case 'failed': return 'sem rota'
    default: return null
  }
}

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

/**
 * Route one inbound peer frame.
 *
 * Every pipe — the relay socket, the local-tab channel and the direct mesh —
 * ends here, so there is ONE place that knows what a peer frame is:
 *
 *   - the relay wraps every client-to-client frame in `SWARM_FRAME` (a bare
 *     `type` key could shadow a server-published event, audit A2);
 *   - the mesh and the local channel carry announcements bare.
 *
 * The frames are NARROWED by the shared contract (@orbit/protocol): a field
 * of the wrong type is dropped, and a frame that does not fit its declared
 * shape never reaches a handler.
 */
export function routeInboundFrame(
  raw: unknown,
  onSwarm: (msg: SwarmMessage) => void,
  onAnnounce: (msg: SwarmAnnounce) => void,
): boolean {
  const envelope = parseSwarmEnvelope(raw)
  if (envelope) {
    if (envelope.kind === 'swarm') onSwarm(envelope.frame)
    else onAnnounce(envelope.announce)
    return true
  }
  const announce = parseBareSwarmAnnounce(raw)
  if (announce) {
    onAnnounce(announce)
    return true
  }
  return false
}

/** The same 24h window the storage hydration uses: entries unseen for longer
 *  are ghosts and are dropped (plan B1). Pure so it is unit-testable. */

// Module-level so it can be referenced from the WebSocket effect without
// ordering issues and keeps a stable identity (not memoized in the hook).
function transmitOverWebSocket(socket: WebSocket | null, queue: SwarmAnnounce[], msg: SwarmAnnounce) {
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
  //
  // The frame is sent WHOLE. This used to be split into top-level
  // `{type:'SWARM_CHUNK'}` frames above 30 KB, justified by a "relay frame
  // splitting threshold" that does not exist: the relay does no splitting, and
  // its audit-A2 rule drops every top-level frame with a string `type`. So the
  // chunker sent frames the relay refused — a >30 KB announcement was not
  // split, it was LOST. The relay now enforces a real size bound
  // (apps/api/src/ws-bus.ts, MAX_RELAY_FRAME_BYTES) and the producer bounds
  // what it announces.
  const fullPayloadStr = JSON.stringify({ type: 'SWARM_FRAME', swarm: msg });
  logger.log('[ORBIT Network Swarm] Transmitting event over WebSocket network to remote peers for item:', msg.payload?.id || msg.type);
  socket.send(fullPayloadStr);
}

export function useP2P(identity: OrbitIdentity | null) {
  const [peers, setPeers] = useState<User[]>([]);

  // THE roster: one owner for "who is online". Every discovery stack (the
  // node roster, the swarm PRESENCE frame, a PROFILE frame and the tracker
  // mesh) writes through it, so a peer is described the same way whoever
  // found it. See utils/peerRoster.ts.
  const rosterRef = useRef<PeerRoster | null>(null);
  if (!rosterRef.current) rosterRef.current = new PeerRoster();
  const roster: PeerRoster = rosterRef.current;
  useEffect(
    () => roster.subscribe((next) => setPeers((prev) => (areUsersStructurallyEqual(prev, next) ? prev : next))),
    [roster],
  );

  // Mesh discovery: announce a rotating infohash on public trackers so peers
  // on other machines can find this one. The node relay stays the floor.
  const meshRef = useRef<MeshHandle | null>(null);
  useEffect(() => {
    if (!identity || typeof window === 'undefined') return;
    const settings = readSettings();
    if (!settings.meshEnabled) return;
    let dead = false;
    void startMesh({
      identity: {
        orbitId: identity.orbitId,
        publicKeyHex: identity.publicKeyHex,
        privateKeyHex: identity.privateKeyHex,
        encryptionPubHex: identity.encryptionPubHex,
      },
      communityKey: () => readSettings().meshCommunityKey,
      // A tracker peer that completed the signed HELLO handshake is a
      // VERIFIED peer: its orbitId is the hash of the key it proved it owns.
      // It used to carry bytes over the DataChannel and stay invisible —
      // the roster had no way to hear about it, because the only roster
      // writer was a closure trapped inside the WebSocket effect.
      onPeer: (peer) => {
        const user = meshPeerAsUser(peer);
        if (!user) return;
        const result = roster.upsert(user);
        if (result.becameOnline) announcePeerOnline(peer.orbitId);
      },
    }).then((mesh) => {
      if (dead) { mesh.stop(); return; }
      meshRef.current = mesh;
    });
    // Settings -> Mesh commits a new community key: re-announce on the new
    // infohash now instead of waiting for the next 30-minute tick.
    const onReannounce = () => void meshRef.current?.refresh();
    window.addEventListener('gmatch:mesh-reannounce', onReannounce);

    return () => {
      dead = true;
      window.removeEventListener('gmatch:mesh-reannounce', onReannounce);
      meshRef.current?.stop();
      meshRef.current = null;
    };
  }, [identity, roster]);
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

  // Committed API-base generation: bumped on every seamless world switch so
  // the connection effect below re-runs (cleanup closes the old socket, the
  // new run dials the new base). The app shell never remounts.
  const [baseGen, setBaseGen] = useState(0);
  const lastBaseRef = useRef<string>('');
  useEffect(() => subscribeApiBase(() => setBaseGen((g) => g + 1)), []);
  const wsRef = useRef<WebSocket | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sendHeartbeatRef = useRef<() => void>(() => {});

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
      roster.markAllOffline();
    }
    lastBaseRef.current = runBase;

    // 1. Initialize Cross-Tab Broadcast Channel Swarm
    const channel = new BroadcastChannel('orbit_p2p_swarm');
    channelRef.current = channel;
    const selfUser = selfUserRef.current;

    // Swarm transport wire: allow requestSwarmObject / handleSwarmMessage to
    // fan out WANT and CHUNK frames over BroadcastChannel (same-device tabs),
    // WebSocket relay (network peers), and direct WebRTC DataChannel mesh.
    // Every pipe is best-effort per frame — chunk reassembly is index-based,
    // so a withheld frame is a retry, never corruption; the relay socket
    // carries the same low-water gate as the DataChannel send (one shared
    // rule so a congested pipe cannot swallow RAM either).
    setSwarmTransport((msg: SwarmMessage) => {
      try { channel.postMessage({ type: 'SWARM_FRAME', swarm: msg }); } catch {}
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount <= MESH_BACKPRESSURE_HIGH_BYTES) {
        ws.send(JSON.stringify({ type: 'SWARM_FRAME', swarm: msg }));
      }
      broadcastMeshFrame(JSON.stringify({ type: 'SWARM_FRAME', swarm: msg }));
    });

    const unsubMesh = onMeshMessage((data: string) => {
      try {
        const parsed = JSON.parse(data);
        routeInboundFrame(parsed, (m) => { void handleSwarmMessage(m); }, processSwarmMessage);
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
      const { acceptInboundOperation, applyOperationAck, broadcastPendingOperations, broadcastRecentOperations } = await import('../services/socialOpTransport')
      const { wireOperationBroadcast } = await import('../services/socialOpBroadcast')
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
      // A peer that joined after an operation was already acked by someone else
      // never receives it from `broadcastPendingOperations` (status='delivered').
      // Re-offer a bounded recent slice on each peer-online wave, throttled so a
      // busy roster cannot turn into a broadcast storm.
      let lastRecentWave = 0
      const broadcastRecent = () => {
        const now = Date.now()
        if (now - lastRecentWave < 20_000) return
        lastRecentWave = now
        void broadcastRecentOperations(operationLog, (operation) => {
          sendSwarmFrame({ type: 'SWARM_OP', operation })
        }).catch(() => {})
      }
      const broadcastAll = () => {
        broadcastOperations()
        broadcastRecent()
      }
      broadcastAll()
      window.addEventListener(PEER_ONLINE_EVENT, broadcastAll)
      // The waves above fire on boot and on peer-online only, so an operation
      // committed while a peer was ALREADY online was never handed to the
      // network — a post made in front of your friend did not reach them until
      // one side reconnected. Every write announces itself on the durable log,
      // so send the new entry now (coalesced, unsent-only; see the module).
      const unwireBroadcast = wireOperationBroadcast({
        log: operationLog,
        sendOperation: (operation) => { sendSwarmFrame({ type: 'SWARM_OP', operation }) },
      })
      teardownOperations = () => {
        unwireBroadcast()
        window.removeEventListener(PEER_ONLINE_EVENT, broadcastAll)
        setSwarmOperationHandler(null)
        setSwarmOperationAckHandler(null)
      }
    }).catch(() => { /* operation transport unavailable this session */ })

    // Load saved known peers from storage on mount. Entries unseen for over
    // 24h are dropped so ancient ghosts never resurrect; the rest hydrate as
    // offline until the roster/swarm confirms them fresh. A peer we already
    // know is NOT overwritten — a world switch must not replace a live
    // online peer with its stale persisted copy.
    try {
      const savedPeers = localStorage.getItem('orbit_p2p_known_peers');
      if (savedPeers) roster.hydrate(JSON.parse(savedPeers));
    } catch {}

    // Periodic ghost sweep (plan B1): the map used to grow for the whole
    // session. Hourly is plenty — entries die at 24h unseen.
    const pruneTimer = setInterval(() => {
      roster.prune();
    }, 60 * 60 * 1000);

    /**
     * Apply one peer announcement.
     *
     * Every pipe ends here (the relay socket, the local-tab channel and the
     * direct mesh), so there is ONE announcement handler. The frames arrive
     * NARROWED (see routeInboundFrame): a peer cannot hand this function a
     * chat line without text or an object without an id.
     *
     * A local tab's own announcement is the SAME identity, so it is not a
     * peer: it does not enter the roster and it is not stored again (the
     * bytes are already local) — but the other tab still lists the item.
     */
    const processSwarmMessage = (data: SwarmAnnounce) => {
      const currentSelf = selfUserRef.current;
      const isSelf = data.user.id === currentSelf.id;

      if (!isSelf) {
        logger.log('[ORBIT Network Swarm] Discovered remote peer:', data.user.display_name || data.user.id, 'Type:', data.type);

        const sighting = roster.upsert(data.user);
        // Offline seeder coming back: wake failed P2P tiles so they retry.
        if (sighting.becameOnline) announcePeerOnline(data.user.id);
      }

      if (data.type === 'PRESENCE') {
        // A presence beacon says nothing else; the roster heartbeat is
        // periodic and authoritative.
        if (!isSelf) logger.log('[ORBIT Network Swarm] Remote peer online presence confirmed:', data.user.display_name || data.user.id);
      } else if (data.type === 'STORY_ANNOUNCE') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('orbit-story-announce'))
        }
      } else if (data.type === 'CHAT' && data.chatMessage) {
        const chan = data.chatMessage.channel || data.channel || 'global_lobby';
        const msgWithChan: ChatMessage = { ...data.chatMessage, channel: chan };
        logger.log('[ORBIT Chat] Swarm chat message:', msgWithChan.text.slice(0, 30));
        setChatMessages(prev => {
          if (prev.some(m => m.id === msgWithChan.id)) return prev;
          return [...prev, msgWithChan];
        });
      } else if ((data.type === 'IMAGE_ANNOUNCE' || data.type === 'MESSAGE') && data.payload) {
        const newItem = data.payload;
        logger.log('[ORBIT Network Swarm] Received IMAGE_ANNOUNCE payload from peer:', data.user.display_name || data.user.id, 'Item ID:', newItem.id, 'DataURL Length:', newItem.content_url?.length || 0);

        // An announcement DESCRIBES an object; it never carries its bytes. The
        // provider link is stored as `source_url` — separate from `data` — and
        // the claimed owner is only accepted when the envelope's sender proves
        // it (a relayed claim stays unverified instead of impersonating).
        const claim = resolveClaimedOwner(newItem.owner_id, data.relayedBy || data.user.id)

        if (newItem.content_url && !isSelf) {
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
                owner_id: claim.owner_id || data.user.id,
                owner_verified: claim.owner_verified,
                sender_pubkey: newItem.sender_pubkey || '',
                sender_enc_pubkey: newItem.sender_enc_pubkey || '',
                created_at: newItem.created_at || new Date().toISOString(),
                data: new ArrayBuffer(0),
                source_url: sourceUrl,
                is_public: mediaFlag(newItem.is_public),
                is_story: mediaFlag(newItem.is_story),
                is_chat: mediaFlag(newItem.is_chat),
                is_avatar: mediaFlag(newItem.is_avatar),
                caption: newItem.caption || newItem.post_caption || '',
                tags: newItem.tags || [],
                author_name: newItem.author_name || newItem.sender_name || '',
                location: newItem.location || '',
                comments: newItem.comments || [],
                likes_count: newItem.likes_count || newItem.like_count || 0,
                comment_count: newItem.comment_count || 0,
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
            // The mirror is a localStorage string: a huge provider link would
            // blow the quota for the whole gallery.
            const safeItems = updated.slice(0, 50).map(i => (
              i.content_url && i.content_url.length > 100000 ? { ...i, content_url: '' } : i
            ));
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
    let courierOnlyWs = isCourierHost(API_WS);
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
      } catch (err) {
        logger.warn('[useP2P] POST /api/ws-ticket failed', err)
      }
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
              if (roster.get(profile.id)) {
                roster.upsert(profile);
              }
              if (typeof window !== 'undefined') {
                try { window.dispatchEvent(new CustomEvent('orbit-profilesync')); } catch {}
              }
              return;
            }

            if (rawData.type === 'lobby-chat' && rawData.action === 'new' && rawData.message && rawData.message.id) {
              const m = rawData.message as { id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel?: string; attachment_id?: string | null; attachment_url?: string | null; attachment_mime?: string | null };
              const chan = m.channel || rawData.channel || 'global_lobby';
              setChatMessages(prev => {
                if (prev.some(x => x.id === m.id)) return prev;
                return [...prev, {
                  id: m.id,
                  senderId: m.sender_id,
                  senderName: m.sender_name?.trim() || generateFallbackName(m.sender_id),
                  text: m.body,
                  timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
                  channel: chan,
                  attachmentId: m.attachment_id || undefined,
                  attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
                  attachmentMime: m.attachment_mime || undefined,
                }].sort((a, b) => a.timestamp - b.timestamp);
              });
              return;
            }
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

    // 4. Broadcast presence heartbeat over local BroadcastChannel & WebSocket network.
    const sendHeartbeat = () => {
      // Skip presence broadcasts from hidden tabs: browsers throttle background
      // timers anyway, and hidden tabs should not contribute swarm noise.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const currentSelf = selfUserRef.current;
      const msg: SwarmAnnounce = {
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
      // Courier mode: the roster is the presence mailbox of EVERY node we
      // know — ours, plus the nodes peers told us they live on. A peer on
      // another node is then reachable (its mailbox is there), which is what
      // makes the mesh work across the open internet without a hub.
      const crossNodeRoster = async (): Promise<{ users: User[] }> => {
        rememberKnownNode(getApiBaseUrl())
        const nodes = [getApiBaseUrl(), ...knownNodes()].filter(Boolean)
        const seen = new Set<string>()
        const users: User[] = []
        // Bounded: a client never fans out to the whole known-node list in
        // one round. The nearest nodes come first (ours is always first).
        let asked = 0
        for (const node of nodes) {
          if (asked >= MAX_ROSTER_NODES_PER_ROUND) break
          const base = node.replace(/\/+$/, '')
          if (seen.has(base)) continue
          seen.add(base)
          asked++
          const roster = await fetchPresenceRosterFrom(base, selfUserRef.current.id).catch(() => ({ users: [], nodeById: new Map<string, string>() }))
          for (const [peerId, peerNode] of roster.nodeById) rememberPeerNode(peerId, peerNode)
          users.push(...roster.users)
        }
        return { users }
      }
      ;(courierOnlyWs
        ? crossNodeRoster()
        : orbitFetch('/api/users/online', {}, identity).then((r) => (r.ok ? r.json() : { users: [] })).catch(() => ({ users: [] })))
        .then((res: any) => (res && 'users' in res ? res : (res && res.ok ? res.json() : { users: [] })))
        .then(({ users }: { users?: User[] }) => {
          // NOTE: an empty roster is a valid signal (everyone left) — it
          // still runs so leavers decay to offline instead of lingering.
          if (!Array.isArray(users)) return
          // The roster owns the merge AND the transition detection: it returns
          // the peers that just came online, so there is no second "was this
          // peer online before?" bookkeeping here.
          const newlyOnline = roster.mergeServerRoster(users, selfUserRef.current.id);
          // Freshly-online roster members may be seeders for failed P2P
          // tiles — wake them to retry.
          for (const u of newlyOnline) {
            announcePeerOnline(u.id)
            const pubKey = u.publicKey || (u as any).public_key
            const encKey = u.encryptionPubKey || (u as any).encryption_pub_key
            if (courierOnlyWs && pubKey && encKey) {
              // Transport selection (P0): every roster arrival gets one
              // deadline-bounded direct attempt. The node's relay carries
              // the frames meanwhile; failure schedules a backoff retry.
              swarmTransportRegistry.startDirectAttempt(u.id)
              void connectToPeerMesh({ id: u.id, public_key: pubKey, encryption_pub_key: encKey }, identity)
                .then(() => swarmTransportRegistry.markDirectValidated(u.id))
                .catch((err) => swarmTransportRegistry.markDirectFailed(
                  u.id,
                  err instanceof Error ? err.message : 'direct connect failed',
                  true,
                ))
            }
          }
        })
        .catch(() => {})
    }
    pullRoster()
    const rosterInterval = setInterval(pullRoster, 60_000)

    // 4d. Transport-selection tick (P0): decay deadlines, keep the relay
    // mapping honest, and fire due direct retries. Cheap: a few dozen peers,
    // no network I/O except an at-most-one retry per cycle.
    const transportTick = () => {
      if (!identity) return
      for (const [peerId, entry] of swarmTransportRegistry.snapshot()) {
        if (entry.phase === 'connecting-direct' && swarmTransportRegistry.isDirectAttemptOverdue(peerId)) {
          swarmTransportRegistry.markDirectFailed(peerId, 'direct attempt deadline', true)
        }
      }
      for (const [peerId, peer] of roster.entries()) {
        if (peerId === selfUserRef.current.id || !peer?.online) continue
        const phase = swarmTransportRegistry.phaseFor(peerId)
        if (phase === 'idle' || phase === 'failed') {
          // Frames for this peer ride the node's relay until proven direct.
          swarmTransportRegistry.markRelayInUse(peerId)
          continue
        }
        if (phase !== 'relay' || !swarmTransportRegistry.shouldRetryDirect(peerId)) continue
        const pubKey = peer.publicKey || (peer as any).public_key
        const encKey = peer.encryptionPubKey || (peer as any).encryption_pub_key
        if (!pubKey || !encKey) continue
        swarmTransportRegistry.startDirectAttempt(peerId)
        void connectToPeerMesh({ id: peerId, public_key: pubKey, encryption_pub_key: encKey }, identity)
          .then(() => swarmTransportRegistry.markDirectValidated(peerId))
          .catch((err) => swarmTransportRegistry.markDirectFailed(
            peerId,
            err instanceof Error ? err.message : 'direct connect failed',
            true,
          ))
      }
    }
    const transportInterval = setInterval(transportTick, TRANSPORT_TICK_MS)
    // ICE died mid-session: terminate the mesh pipe for that peer. The relay
    // keeps the frames flowing; the next retry re-dials.
    setMeshIceFailureHandler((peerId, reason) => swarmTransportRegistry.markDirectFailed(peerId, reason, true))

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

    // 5. Handle incoming local tab P2P swarm events. The local channel
    // carries the same frames as the relay (wrapped swarm frames) and bare
    // announcements, so it goes through the SAME route.
    channel.onmessage = (event: MessageEvent<unknown>) => {
      routeInboundFrame(event.data, (m) => { void handleSwarmMessage(m); }, processSwarmMessage);
    };

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(rosterInterval);
      clearInterval(transportInterval);
      clearInterval(pruneTimer);
      setMeshIceFailureHandler(null);
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
    };
  }, [identity, baseGen]);

  const loadLobbyHistory = useCallback(async () => {
    if (!identity) return
    try {
      const res = await orbitFetch('/api/lobby/chat', { method: 'GET' }, identity)
      if (!res.ok) return
      const data = await res.json() as { messages?: Array<{ id: string; sender_id: string; sender_name: string | null; body: string; created_at: string; channel?: string; attachment_id?: string | null; attachment_url?: string | null; attachment_mime?: string | null }> }
      if (!Array.isArray(data.messages)) return
      const mapped: ChatMessage[] = data.messages
        .filter((m) => m && m.id && (m.body || m.attachment_id))
        .map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name?.trim() || generateFallbackName(m.sender_id),
          text: m.body,
          timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
          channel: m.channel || 'global_lobby',
          attachmentId: m.attachment_id || undefined,
          attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
          attachmentMime: m.attachment_mime || undefined,
        }))
      setChatMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]))
        for (const message of mapped) byId.set(message.id, message)
        return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp).slice(-100)
      })
    } catch (err) {
      logger.warn('[useP2P] GET /api/lobby/chat failed', err)
    }
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

  const queuedMessagesRef = useRef<SwarmAnnounce[]>([]);

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

      const msg: SwarmAnnounce = {
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

      // Broadcast over network WebSocket to remote swarm peers (the relay
      // enforces its own frame bound; see apps/api/src/ws-bus.ts)
      transmitOverWebSocket(wsRef.current, queuedMessagesRef.current, msg);
      broadcastMeshFrame(JSON.stringify(msg));
    },
    [identity]
  );

  const sendChatMessage = useCallback((
    text: string,
    channel: string = 'global_lobby',
    attachment?: { id: string; url: string; isVideo?: boolean },
  ) => {
    const selfUser = selfUserRef.current;
    if (!selfUser) return;
    if (!text.trim() && !attachment) return;
    const chatMsg: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: selfUser.id,
      // The lobby is a PUBLIC channel, so this name is what every other client
      // renders — resolving it through the shared helper (local storage first)
      // keeps it identical to what the chat hub shows for the same person.
      senderName: resolveDisplayName({
        selfId: selfUser.id,
        senderId: selfUser.id,
        roster: roster.asMap(),
        fallback: selfUser.display_name,
      }),
      text,
      timestamp: Date.now(),
      channel,
      attachmentId: attachment?.id,
      attachmentUrl: attachment?.url,
      attachmentMime: attachment?.isVideo ? 'video/mp4' : attachment ? 'image/*' : undefined,
    };

    const msg: SwarmAnnounce = {
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

    // Persist to the server so the row is the source of truth for a page reload
    // or a late joiner. Fire-and-forget: if it fails we still have the local
    // P2P copy, and the WS push to the lobby room keeps other tabs in sync.
    if (identity) {
      void orbitFetch('/api/lobby/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: chatMsg.id,
          body: chatMsg.text,
          channel,
          attachment_id: attachment?.id,
        }),
      }, identity).catch(() => {});
    }
  }, [identity]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      try {
        const safe = chatMessages.slice(-100);
        localStorage.setItem('orbit_chat_messages', JSON.stringify(safe));
      } catch (err) {
        logger.warn('[useP2P] POST /api/lobby/chat failed', err)
      }
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
