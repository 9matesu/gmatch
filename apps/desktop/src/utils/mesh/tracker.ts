/**
 * Minimal WebTorrent tracker client (announce over WebSocket).
 *
 * Why not the `bittorrent-tracker` package: it answers with IP:port, which is
 * useless for WebRTC, and the SDP exchange it does support lives in
 * `simple-peer` — which creates its own RTCPeerConnection outside this app's
 * ICE hygiene (literal-IP candidates stripped, mDNS only). ~150 lines here cost
 * less than a dependency that fights the code.
 *
 * Wire format (what public trackers expect):
 *   → {"action":"announce","info_hash":"<20 binary chars>","peer_id":"<20 binary chars>",
 *      "num_w":2,"left":0,"uploaded":0,"downloaded":0,"event":"started",
 *      "offers":[{"offer_id":"<20 binary chars>","offer":"<base64 sdp>"}]}
 *   ← {"action":"announce","interval":1800,"complete":0,"incomplete":1,
 *      "answers":[{"offer_id":"...","answer":"<base64 sdp>"}]}
 *
 * `info_hash`, `peer_id` and `offer_id` are BINARY strings, never hex.
 */

import { binaryJson } from './infohash';

export interface TrackerOffer {
  offerId: string;
  offer: string;
}

export interface TrackerAnswer {
  offerId: string;
  answer: string;
}

export interface TrackerStatus {
  tracker: string;
  state: 'online' | 'offline' | 'error';
  peers?: number;
}

export interface TrackerClientOptions {
  /** At least 3 distinct operators; all are tried in parallel. */
  trackers: string[];
  /** The ±1 day window, so a skewed clock still lands in the swarm. */
  infoHashes: () => Promise<Uint8Array[]>;
  /** This client's 20-byte peer id (stable for the session). */
  peerId: () => Uint8Array;
  /** Offers we want answered right now (usually empty: we answer, not ask). */
  offers?: () => TrackerOffer[];
  /** An answer we owe a peer, sent on the next announce. */
  answer?: () => TrackerAnswer | null;
  /** How many peers we still want. */
  numWant?: number;
  onAnswers?: (answers: TrackerAnswer[]) => void;
  /** Offers from other peers (trackers that relay them). */
  onOffers?: (offers: TrackerOffer[]) => void;
  onStatus?: (status: TrackerStatus) => void;
  /** Test seam. */
  socketImpl?: (url: string) => WebSocket;
  /** Max reconnect attempts per tracker (bounded: trackers die). */
  maxRetries?: number;
  /** Re-announce cadence; trackers expire a peer after `interval`. */
  reAnnounceMs?: number;
}

export interface TrackerHandle {
  stop: () => void;
  /** Re-announce now (new community key, network change). */
  announce: () => Promise<void>;
}

/** A 20-byte id arrives as a binary string (or hex): normalise to bytes. */
function idBytes(id: string): Uint8Array {
  const out = new Uint8Array(20);
  if (id.length === 40 && /^[0-9a-f]+$/i.test(id)) {
    for (let i = 0; i < 20; i++) out[i] = parseInt(id.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  for (let i = 0; i < Math.min(20, id.length); i++) out[i] = id.charCodeAt(i) & 0xff;
  return out;
}

function announcePayload(
  infoHash: Uint8Array,
  peerId: Uint8Array,
  offers: TrackerOffer[],
  numWant: number,
  answer: TrackerAnswer | null,
): string {
  const fields = [
    `"action":"announce"`,
    `"info_hash":"${binaryJson(infoHash)}"`,
    `"peer_id":"${binaryJson(peerId)}"`,
    `"num_w":${Math.max(0, Math.min(32, Math.floor(numWant)))}`,
    `"left":0`,
    `"uploaded":0`,
    `"downloaded":0`,
    `"event":"started"`,
    `"compact":0`,
  ];
  if (answer) {
    fields.push(`"offer_id":"${binaryJson(idBytes(answer.offerId))}"`);
    fields.push(`"answer":${JSON.stringify(answer.answer)}`);
  }
  if (offers.length > 0) {
    const list = offers
      .slice(0, 2)
      .map((o) => `{"offer_id":"${binaryJson(idBytes(o.offerId))}","offer":${JSON.stringify(o.offer)}}`)
      .join(',');
    fields.push(`"offers":[${list}]`);
  }
  return `{${fields.join(',')}}`;
}

function parseOffers(msg: Record<string, unknown>): TrackerOffer[] {
  const raw = Array.isArray(msg.offers) ? msg.offers : [];
  const out: TrackerOffer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.offer_id !== 'string' || typeof row.offer !== 'string') continue;
    out.push({ offerId: row.offer_id, offer: row.offer });
  }
  return out;
}

function parseAnswers(msg: Record<string, unknown>): TrackerAnswer[] {
  const raw = Array.isArray(msg.answers) ? msg.answers : [];
  const out: TrackerAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.offer_id !== 'string' || typeof row.answer !== 'string') continue;
    out.push({ offerId: row.offer_id, answer: row.answer });
  }
  return out;
}

export async function startTrackerClient(opts: TrackerClientOptions): Promise<TrackerHandle> {
  const sockets = new Map<string, WebSocket>();
  const retries = new Map<string, number>();
  const socketFor = opts.socketImpl ?? ((url: string) => new WebSocket(url));
  let closed = false;

  const announceAll = async () => {
    if (closed) return;
    const hashes = await opts.infoHashes().catch(() => []);
    if (hashes.length === 0) return;
    const peerId = opts.peerId();
    const offers = (opts.offers?.() ?? []).filter((o) => o.offerId && o.offer);
    for (const infoHash of hashes) {
      const answer = opts.answer?.() ?? null;
      const payload = announcePayload(infoHash, peerId, offers, opts.numWant ?? 2, answer);
      for (const [tracker, socket] of sockets) {
        if (socket.readyState !== 1) continue;
        try {
          socket.send(payload);
        } catch {
          opts.onStatus?.({ tracker, state: 'error' });
        }
      }
    }
  };

  const connect = (tracker: string) => {
    if (closed || sockets.has(tracker)) return;
    let socket: WebSocket;
    try {
      socket = socketFor(tracker);
    } catch {
      opts.onStatus?.({ tracker, state: 'error' });
      return;
    }
    sockets.set(tracker, socket);

    socket.addEventListener('open', () => {
      retries.set(tracker, 0);
      opts.onStatus?.({ tracker, state: 'online' });
      void announceAll();
    });

    socket.addEventListener('message', (event) => {
      let msg: Record<string, unknown> | null = null;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || msg.action !== 'announce') return;
      const answers = parseAnswers(msg);
      if (answers.length > 0) opts.onAnswers?.(answers);
      const offers = parseOffers(msg);
      if (offers.length > 0) opts.onOffers?.(offers);
      opts.onStatus?.({
        tracker,
        state: 'online',
        peers: typeof msg.incomplete === 'number' ? msg.incomplete : 0,
      });
    });

    socket.addEventListener('error', () => {
      opts.onStatus?.({ tracker, state: 'error' });
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    });

    socket.addEventListener('close', () => {
      sockets.delete(tracker);
      opts.onStatus?.({ tracker, state: 'offline' });
      if (closed) return;
      const attempts = retries.get(tracker) ?? 0;
      if (attempts >= (opts.maxRetries ?? 4)) return;
      retries.set(tracker, attempts + 1);
      // Bounded backoff: a dead tracker must not become a reconnect storm.
      const delay = Math.min(60_000, 2_000 * 2 ** attempts);
      setTimeout(() => connect(tracker), delay);
    });
  };

  for (const tracker of opts.trackers) connect(tracker);

  const timer = setInterval(() => void announceAll(), opts.reAnnounceMs ?? 120_000);

  return {
    stop: () => {
      closed = true;
      clearInterval(timer);
      for (const socket of sockets.values()) {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      }
      sockets.clear();
    },
    announce: announceAll,
  };
}