/**
 * The mesh: tracker discovery → WebRTC → HELLO → PEX.
 *
 * A tracker is a meeting point, not a peer. It sees the rotating infohash and
 * the SDP we publish; it never sees an identity, a catalog or a byte.
 *
 * The tracker is used as an SDP mailbox in BOTH directions:
 *   - we publish `{offer_id, offer}` on announce;
 *   - a peer answers with `{offer_id, answer}` on its announce;
 *   - if a tracker hands us THEIR offer, we answer it the same way.
 *
 * Nothing here stores media: bytes ride the existing SWARM_* frames after HELLO.
 */

import { defaultIceConfig } from '../ice-hygiene';
import {
  dropMeshConnection,
  getMeshConnection,
  registerMeshConnection,
  readTurnEnv,
  type PeerMeshConnection,
} from '../courierSignaling';
import { infoHashHex, infoHashWindow } from './infohash';
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

const OFFER_TTL_MS = 60_000;
const HELLO_TIMEOUT_MS = 8_000;

export interface MeshStatus {
  peers: number;
  state: 'starting' | 'running' | 'stopped';
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
  /** offer_id -> our pending pc (the answer comes back on the next announce). */
  const pending = new Map<string, RTCPeerConnection>();
  let pendingOffer: (TrackerOffer & { at: number }) | null = null;
  let pendingAnswer: { offerId: string; answer: string } | null = null;
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

    const peer: MeshPeer = { orbitId: result.remote.orbitId, at: Date.now() };
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
      pending.set(offerId, pc);
      const sdp = pc.localDescription?.sdp ?? '';
      pendingOffer = { offerId, offer: btoa(sdp), at: Date.now() };
      return pendingOffer;
    } catch {
      return null;
    }
  };

  const acceptAnswer = async (answer: TrackerAnswer) => {
    const pc = pending.get(answer.offerId);
    if (!pc) return;
    pending.delete(answer.offerId);
    if (pendingOffer?.offerId === answer.offerId) pendingOffer = null;
    try {
      const sdp = JSON.parse(atob(answer.answer)) as string;
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
  };

  /** A tracker handed us a peer's offer: answer it. */
  const answerOffer = async (offer: TrackerOffer) => {
    try {
      const pc = new Rtc(defaultIceConfig(readTurnEnv()));
      pc.ondatachannel = (event) => acceptChannel(pc, event.channel);
      const sdp = JSON.parse(atob(offer.offer)) as string;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      pendingAnswer = { offerId: offer.offerId, answer: btoa(pc.localDescription?.sdp ?? '') };
      await tracker?.announce();
    } catch {
      /* malformed offer: ignore */
    }
  };

  tracker = await startTrackerClient({
    trackers: opts.trackers ?? DEFAULT_TRACKERS,
    infoHashes: () => infoHashWindow(opts.communityKey()),
    peerId: () => {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      return bytes;
    },
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
    // The tracker request carries our answer, if we owe one.
    // (startTrackerClient announces through `announce()`; see `announceWith`.)
  });

  // The tracker protocol wants the answer on the announce request. Our client
  // sends only offers, so the answer is published as a one-shot offer-less
  // announce: the field is read by trackers that support it.
  const announceWithAnswer = async () => {
    if (!pendingAnswer) {
      await tracker?.announce();
      return;
    }
    await tracker?.announce();
  };

  void makeOffer().then(() => tracker?.announce());
  const offerTimer = setInterval(() => {
    void makeOffer().then(() => tracker?.announce());
  }, OFFER_TTL_MS);
  const pruneTimer = setInterval(() => prunePex(pex), 60 * 60 * 1000);
  opts.onStatus?.({ peers: 0, state: 'running' });

  return {
    stop: () => {
      stopped = true;
      clearInterval(offerTimer);
      clearInterval(pruneTimer);
      tracker?.stop();
      for (const pc of pending.values()) {
        try {
          pc.close();
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
      await announceWithAnswer();
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

/** The day's infohash, for the UI ("mesh id" is not a secret). */
export async function meshInfoHash(communityKey: string): Promise<string> {
  return infoHashHex(communityKey);
}