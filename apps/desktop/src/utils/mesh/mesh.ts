/**
 * The mesh: tracker discovery → WebRTC → HELLO → PEX.
 *
 * A tracker is a meeting point, not a peer. It sees the rotating infohash and
 * the SDP we publish; it never sees an identity, a catalog or a byte.
 *
 * The tracker is used as an SDP mailbox in BOTH directions:
 *   - we publish `{offer_id, offer:{type,sdp}}` on announce;
 *   - a peer answers with `{offer_id, answer:{type,sdp}}` on its announce;
 *   - if a tracker hands us THEIR offer, we answer it the same way.
 *
 * The wire is the reference `bittorrent-tracker` protocol — see tracker.ts for
 * the exact shapes and the three silent ways to get it wrong.
 *
 * Nothing here stores media: bytes ride the existing SWARM_* frames after HELLO.
 */

import { defaultIceConfig } from '../ice-hygiene';
import type { User } from '@orbit/shared';
import {
  dropMeshConnection,
  getMeshConnection,
  registerMeshConnection,
  readTurnEnv,
  type PeerMeshConnection,
} from '../courierSignaling';
import { infoHashWindow } from './infohash';
import { exchangeHello, localFingerprint, type Signer } from './hello';
import {
  addPeer,
  buildPex,
  createPexTable,
  encodePex,
  ingestPex,
  prunePex,
  type MeshPeer,
  type PexTable,
} from './pex';
import { startTrackerClient, type TrackerAnswer, type TrackerHandle, type TrackerOffer } from './tracker';

export const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
];

/** How long one published offer stays fresh (the reference's OFFER_TIMEOUT). */
const OFFER_TTL_MS = 50_000;
/** Re-announce cadence (the reference's DEFAULT_ANNOUNCE_INTERVAL). */
const ANNOUNCE_MS = 30_000;
/** An unanswered connection is dropped after this (it holds a socket). */
const PENDING_TTL_MS = 90_000;
const HELLO_TIMEOUT_MS = 8_000;

export interface MeshStatus {
  peers: number;
  state: 'starting' | 'running' | 'stopped';
}

/**
 * The roster row for a verified mesh peer.
 *
 * The HELLO is signed and the orbitId is the hash of the key the peer proved
 * it owns, so this identity is VERIFIED: the peer can enter the roster with
 * the same trust as one the node listed. A peer with no key is not a peer —
 * `null` means "do not show it".
 */
export function meshPeerAsUser(peer: MeshPeer): User | null {
  if (!peer?.orbitId || !peer.pubKeyHex) return null;
  return {
    id: peer.orbitId,
    publicKey: peer.pubKeyHex,
    encryptionPubKey: peer.encPubHex,
    createdAt: new Date().toISOString(),
    display_name: '',
  };
}

export interface MeshOptions {
  identity: Signer;
  /** Open mesh by default; an invite replaces it with a closed community. */
  communityKey: () => string;
  trackers?: string[];
  onPeer?: (peer: MeshPeer) => void;
  onStatus?: (status: MeshStatus) => void;
  /** Test seam. */
  rtc?: typeof RTCPeerConnection;
  /** Test seam: the tracker's WebSocket factory. */
  socketImpl?: (url: string) => WebSocket;
}

export interface MeshHandle {
  stop: () => void;
  /** Re-announce now (community key changed, network changed). */
  refresh: () => Promise<void>;
  peers: () => MeshPeer[];
  send: (peerId: string, text: string) => boolean;
}

function waitIce(pc: RTCPeerConnection, budgetMs = 3_000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, budgetMs);
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startMesh(opts: MeshOptions): Promise<MeshHandle> {
  const pex: PexTable = createPexTable();
  const identity = opts.identity;
  const Rtc = opts.rtc ?? RTCPeerConnection;
  /**
   * The tracker peer id identifies US to the tracker for the whole session.
   *
   * It used to be freshly generated on every announce, so the tracker saw a
   * NEW peer each time: our own ghost entries piled up in the room, and the
   * answer to an offer we published could no longer be routed back to us (the
   * tracker relays an answer to `to_peer_id`, the peer id we announced with).
   */
  const trackerPeerId = (() => {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return bytes;
  })();
  const trackerPeerHex = [...trackerPeerId].map((b) => b.toString(16).padStart(2, '0')).join('');
  /** offer_id -> our pending pc (the answer comes back on the next announce). */
  const pending = new Map<string, { pc: RTCPeerConnection; at: number }>();
  let pendingOffer: (TrackerOffer & { at: number }) | null = null;
  let pendingAnswer: (TrackerAnswer & { at: number }) | null = null;
  let tracker: TrackerHandle | null = null;
  let stopped = false;

  const authenticate = async (pc: RTCPeerConnection, channel: RTCDataChannel) => {
    const result = await exchangeHello(
      {
        send: (text) => {
          try {
            channel.send(text);
          } catch {
            /* channel died mid-handshake */
          }
        },
        onMessage: (cb) => {
          const listener = (event: MessageEvent) => {
            const data = typeof event.data === 'string' ? event.data : '';
            if (data.startsWith('{')) cb(data);
          };
          channel.addEventListener('message', listener);
          return () => channel.removeEventListener('message', listener);
        },
      },
      identity,
      localFingerprint(pc),
      HELLO_TIMEOUT_MS,
    );
    if (!result || stopped) {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      return;
    }

    // The HELLO is signed and the orbitId is the hash of the key the peer
    // proved it owns, so this identity is VERIFIED — the peer can enter the
    // roster with the same trust as one the node listed.
    const peer: MeshPeer = {
      orbitId: result.remote.orbitId,
      pubKeyHex: result.remote.pubKeyHex,
      encPubHex: result.remote.encPubHex,
      at: Date.now(),
    };
    addPeer(pex, peer);

    const conn: PeerMeshConnection = {
      peerOrbitId: peer.orbitId,
      pc,
      channel,
      send: (data) => {
        // This path is text-only (HELLO, PEX); the swarm uses its own channel.
        try {
          channel.send(typeof data === 'string' ? data : String(data));
        } catch {
          /* closed */
        }
      },
      close: () => {
        try {
          pc.close();
        } catch {
          /* already closed */
        }
        dropMeshConnection(peer.orbitId, pc);
      },
    };
    registerMeshConnection(conn);
    opts.onPeer?.(peer);
    opts.onStatus?.({ peers: pex.peers.length, state: 'running' });

    // PEX rides the same authenticated channel, both ways.
    const payload = buildPex(pex, peer.orbitId);
    if (payload) conn.send(JSON.stringify(encodePex(payload)));
    channel.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || !event.data.includes('SWARM_PEX')) return;
      try {
        const msg = JSON.parse(event.data) as { type?: string; peers?: MeshPeer[] };
        if (msg.type !== 'SWARM_PEX') return;
        ingestPex(pex, peer.orbitId, msg);
      } catch {
        /* malformed: drop */
      }
    });
    const onClose = () => dropMeshConnection(peer.orbitId, pc);
    channel.addEventListener('close', onClose);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onClose();
    });
  };

  const acceptChannel = (pc: RTCPeerConnection, channel: RTCDataChannel) => {
    channel.addEventListener('open', () => void authenticate(pc, channel));
  };

  const makeOffer = async (): Promise<TrackerOffer | null> => {
    try {
      const pc = new Rtc(defaultIceConfig(readTurnEnv()));
      const channel = pc.createDataChannel('gmatch-mesh');
      acceptChannel(pc, channel);
      const offerId = randomHex(20);
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      pending.set(offerId, { pc, at: Date.now() });
      const sdp = pc.localDescription?.sdp ?? '';
      // The SDP travels as an OBJECT. The tracker wire has no base64 form:
      // a string offer is not an offer.
      const offer: TrackerOffer = {
        offerId,
        peerId: trackerPeerHex,
        infoHash: '',
        offer: { type: 'offer', sdp },
      };
      pendingOffer = { ...offer, at: Date.now() };
      return pendingOffer;
    } catch {
      return null;
    }
  };

  const acceptAnswer = async (answer: TrackerAnswer) => {
    const entry = pending.get(answer.offerId);
    if (!entry) return;
    pending.delete(answer.offerId);
    if (pendingOffer?.offerId === answer.offerId) pendingOffer = null;
    try {
      await entry.pc.setRemoteDescription(answer.answer);
    } catch {
      try {
        entry.pc.close();
      } catch {
        /* already closed */
      }
    }
  };

  /** A tracker handed us a peer's offer: answer it so it can connect to us. */
  const answerOffer = async (offer: TrackerOffer) => {
    try {
      const pc = new Rtc(defaultIceConfig(readTurnEnv()));
      pc.ondatachannel = (event) => acceptChannel(pc, event.channel);
      await pc.setRemoteDescription(offer.offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      // The answer must name the peer it answers (`to_peer_id`): the tracker
      // server drops an answer without it, so the offering peer never hears
      // back. It also travels as an OBJECT.
      pendingAnswer = {
        offerId: offer.offerId,
        peerId: offer.peerId,
        infoHash: offer.infoHash,
        answer: { type: 'answer', sdp: pc.localDescription?.sdp ?? '' },
        at: Date.now(),
      };
      await tracker?.announce();
    } catch {
      /* malformed offer: ignore */
    }
  };

  tracker = await startTrackerClient({
    trackers: opts.trackers ?? DEFAULT_TRACKERS,
    infoHashes: () => infoHashWindow(opts.communityKey()),
    socketImpl: opts.socketImpl,
    // STABLE for the session: a fresh peer id per announce made the tracker
    // see a new peer every time and broke the answer routing.
    peerId: () => trackerPeerId,
    offers: () => (pendingOffer && Date.now() - pendingOffer.at < OFFER_TTL_MS ? [pendingOffer] : []),
    answer: () => {
      const owed = pendingAnswer;
      pendingAnswer = null;
      return owed;
    },
    onAnswers: (answers) => {
      for (const answer of answers) void acceptAnswer(answer);
    },
    onOffers: (offers) => {
      // A peer published an offer: answer it so it can connect to us.
      const next = offers[0];
      if (next) void answerOffer(next);
    },
  });

  void makeOffer().then(() => tracker?.announce());
  const offerTimer = setInterval(() => {
    // Drop the connections nobody answered: an open RTCPeerConnection per
    // unanswered offer is a socket and a video encoder nobody uses.
    const now = Date.now();
    for (const [id, entry] of pending) {
      if (now - entry.at <= PENDING_TTL_MS) continue;
      pending.delete(id);
      try {
        entry.pc.close();
      } catch {
        /* already closed */
      }
    }
    void makeOffer().then(() => tracker?.announce());
  }, ANNOUNCE_MS);
  const pruneTimer = setInterval(() => prunePex(pex), 60 * 60 * 1000);
  opts.onStatus?.({ peers: 0, state: 'running' });

  return {
    stop: () => {
      stopped = true;
      clearInterval(offerTimer);
      clearInterval(pruneTimer);
      tracker?.stop();
      for (const entry of pending.values()) {
        try {
          entry.pc.close();
        } catch {
          /* already closed */
        }
      }
      pending.clear();
      pendingOffer = null;
      pendingAnswer = null;
      opts.onStatus?.({ peers: 0, state: 'stopped' });
    },
    refresh: async () => {
      await tracker?.announce();
    },
    peers: () => [...pex.peers],
    send: (peerId, text) => {
      const conn = getMeshConnection(peerId);
      if (!conn) return false;
      try {
        conn.send(text);
        return true;
      } catch {
        return false;
      }
    },
  };
}
