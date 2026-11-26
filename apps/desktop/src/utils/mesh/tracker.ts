/**
 * Minimal WebTorrent tracker client (announce over WebSocket).
 *
 * Why not the `bittorrent-tracker` package: it answers with IP:port, which is
 * useless for WebRTC, and the SDP exchange it does support lives in
 * `simple-peer` — which creates its own RTCPeerConnection outside this app's
 * ICE hygiene (literal-IP candidates stripped, mDNS only). ~150 lines here cost
 * less than a dependency that fights the code.
 *
 * The wire is the reference `bittorrent-tracker` protocol — the implementation
 * every public WebTorrent tracker runs:
 *
 *   → announce with our offers
 *     {"action":"announce","info_hash":"<20 binary chars>","peer_id":"<20 binary chars>",
 *      "numwant":2,"left":0,"uploaded":0,"downloaded":0,"event":"started",
 *      "offers":[{"offer_id":"<20 binary chars>","offer":{"type":"offer","sdp":"v=0…"}}]}
 *   → announce with an answer (its OWN message: the tracker relays it to
 *     `to_peer_id` and never answers an answer)
 *     {"action":"announce","info_hash":"…","peer_id":"…","to_peer_id":"<20 binary chars>",
 *      "offer_id":"<20 binary chars>","answer":{"type":"answer","sdp":"v=0…"}}
 *   ← an offer relayed to us
 *     {"action":"announce","info_hash":"…","peer_id":"<the offering peer>",
 *      "offer":{"type":"offer","sdp":"…"},"offer_id":"<20 binary chars>"}
 *   ← an answer relayed to us
 *     {"action":"announce","info_hash":"…","peer_id":"<the answering peer>",
 *      "answer":{"type":"answer","sdp":"…"},"offer_id":"<20 binary chars>"}
 *
 * Three things the wire does NOT accept, each of which silently killed the
 * tracker path before it was pinned here:
 *   1. the SDP travels as an OBJECT (`{type,sdp}`), not as base64 and not as
 *      JSON — a string offer is not an offer;
 *   2. an answer MUST carry `to_peer_id` — the tracker server throws
 *      "invalid `to_peer_id` (required with `answer`)" and drops the message,
 *      so the peer that offered never learns the answer;
 *   3. an inbound offer/answer arrives SINGULAR (`offer` / `answer`), never as
 *      an `offers` / `answers` array.
 *
 * `info_hash`, `peer_id`, `to_peer_id` and `offer_id` are BINARY strings (one
 * character per byte), never hex. The mesh keys its maps by hex, so
 * `canonicalId` reconciles the two forms.
 */

import { binaryJson } from './infohash';

/** An SDP as the tracker wire carries it: an object, never a string. */
export interface TrackerSdp {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface TrackerOffer {
  /** HEX offer id (the wire form is binary; `canonicalId` reconciles). */
  offerId: string;
  /** HEX peer id of the peer that published the offer. */
  peerId: string;
  /** HEX infohash of the room the offer was published in. */
  infoHash: string;
  offer: TrackerSdp;
}

export interface TrackerAnswer {
  /** HEX offer id being answered. */
  offerId: string;
  /** HEX peer id of the peer that answered (the tracker routes by it). */
  peerId: string;
  /** HEX infohash of the room the answer belongs to. */
  infoHash: string;
  answer: TrackerSdp;
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
  /** This client's 20-byte peer id. STABLE for the session. */
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

/**
 * The canonical (hex) form of a 20-byte wire id.
 *
 * The tracker wire carries `info_hash`, `peer_id`, `to_peer_id` and `offer_id`
 * as 20 BINARY characters (the tracker compares bytes), while the mesh keys
 * its pending-offer map by the 40-char hex id. The tracker echoes the id it
 * was given, so an answer arrives in the binary form and — without this
 * reconciliation — names an offer the mesh does not know. The answer then
 * finds no pending offer and the connection is silently never made: the
 * tracker path looks alive and connects to NOTHING.
 *
 * `idBytes` accepts either form, so this is a no-op for an id that is already
 * hex and the inverse of `binaryJson` for one that is not.
 */
export function canonicalId(text: string): string {
  return [...idBytes(text)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function announcePayload(
  infoHash: Uint8Array,
  peerId: Uint8Array,
  offers: TrackerOffer[],
): string {
  const list = offers
    .slice(0, 5)
    .map((o) => `{"offer_id":"${binaryJson(idBytes(o.offerId))}","offer":${JSON.stringify(o.offer)}}`)
    .join(',');
  const fields = [
    `"action":"announce"`,
    `"info_hash":"${binaryJson(infoHash)}"`,
    `"peer_id":"${binaryJson(peerId)}"`,
    // The reference names it `numwant`; `num_w` is not a field any tracker
    // reads. The server IGNORES what we send here and derives the peer count
    // from the number of offers we publish (`min(offers.length, 82)`), so
    // publishing an offer is what gets us peers — the field is sent for
    // shape-compatibility with the reference client.
    `"numwant":${Math.max(0, Math.min(5, offers.length))}`,
    `"left":0`,
    `"uploaded":0`,
    `"downloaded":0`,
    `"event":"started"`,
  ];
  if (list) fields.push(`"offers":[${list}]`);
  return `{${fields.join(',')}}`;
}

/**
 * The answer announce.
 *
 * `to_peer_id` is NOT optional: the tracker server parses the announce and
 * THROWS ("invalid `to_peer_id` (required with `answer`)") without it, so the
 * answer is dropped and the peer that offered never hears back.
 */
function answerPayload(infoHash: Uint8Array, peerId: Uint8Array, answer: TrackerAnswer): string {
  const fields = [
    `"action":"announce"`,
    `"info_hash":"${binaryJson(infoHash)}"`,
    `"peer_id":"${binaryJson(peerId)}"`,
    `"to_peer_id":"${binaryJson(idBytes(answer.peerId))}"`,
    `"offer_id":"${binaryJson(idBytes(answer.offerId))}"`,
    `"answer":${JSON.stringify(answer.answer)}`,
  ];
  return `{${fields.join(',')}}`;
}

/** The wire's SDP shape: an object with a type and the text. */
function sdpFrom(value: unknown, kind: 'offer' | 'answer'): TrackerSdp | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.sdp !== 'string' || !row.sdp) return null;
  if (row.type !== undefined && row.type !== kind) return null;
  return { type: kind, sdp: row.sdp };
}

/** An offer relayed to us: SINGULAR `offer`, plus the peer and the room. */
function parseOffer(msg: Record<string, unknown>): TrackerOffer | null {
  const offer = sdpFrom(msg.offer, 'offer');
  if (!offer) return null;
  if (typeof msg.offer_id !== 'string' || typeof msg.peer_id !== 'string') return null;
  return {
    offerId: canonicalId(msg.offer_id),
    peerId: canonicalId(msg.peer_id),
    infoHash: typeof msg.info_hash === 'string' ? canonicalId(msg.info_hash) : '',
    offer,
  };
}

/** An answer relayed to us: SINGULAR `answer`, plus the peer and the room. */
function parseAnswer(msg: Record<string, unknown>): TrackerAnswer | null {
  const answer = sdpFrom(msg.answer, 'answer');
  if (!answer) return null;
  if (typeof msg.offer_id !== 'string' || typeof msg.peer_id !== 'string') return null;
  return {
    offerId: canonicalId(msg.offer_id),
    peerId: canonicalId(msg.peer_id),
    infoHash: typeof msg.info_hash === 'string' ? canonicalId(msg.info_hash) : '',
    answer,
  };
}

/** The hex form of raw bytes (the inverse of `binaryJson`). */
function bytesHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startTrackerClient(opts: TrackerClientOptions): Promise<TrackerHandle> {
  const sockets = new Map<string, WebSocket>();
  const retries = new Map<string, number>();
  /** The socket that delivered an offer — the answer goes back through it. */
  const offerSockets = new Map<string, { socket: WebSocket; tracker: string }>();
  const socketFor = opts.socketImpl ?? ((url: string) => new WebSocket(url));
  /** The rooms we announced, so a message for another room is ignored. */
  let ourHashes = new Set<string>();
  let ourPeerHex = '';
  let closed = false;

  const send = (tracker: string, socket: WebSocket, payload: string) => {
    if (socket.readyState !== 1) return;
    try {
      socket.send(payload);
    } catch {
      opts.onStatus?.({ tracker, state: 'error' });
    }
  };

  const announceAll = async () => {
    if (closed) return;
    const hashes = await opts.infoHashes().catch(() => []);
    if (hashes.length === 0) return;
    const peerId = opts.peerId();
    ourPeerHex = bytesHex(peerId);
    ourHashes = new Set(hashes.map(bytesHex));
    const offers = (opts.offers?.() ?? []).filter((o) => o.offerId && o.offer);
    for (const infoHash of hashes) {
      const payload = announcePayload(infoHash, peerId, offers);
      for (const [tracker, socket] of sockets) send(tracker, socket, payload);
    }

    // The answer rides its OWN announce: the tracker relays it to
    // `to_peer_id` and does not answer an answer.
    const answer = opts.answer?.() ?? null;
    if (!answer) return;
    const payload = answerPayload(idBytes(answer.infoHash), peerId, answer);
    const home = offerSockets.get(answer.offerId);
    if (home && home.socket.readyState === 1) {
      send(home.tracker, home.socket, payload);
      return;
    }
    for (const [tracker, socket] of sockets) send(tracker, socket, payload);
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

      // Our own echo: the tracker relays our offer/answer back to us when it
      // picks us as a candidate.
      if (typeof msg.peer_id === 'string' && canonicalId(msg.peer_id) === ourPeerHex) return;
      // A message about a room we never announced is not ours to answer.
      if (typeof msg.info_hash === 'string' && ourHashes.size > 0) {
        if (!ourHashes.has(canonicalId(msg.info_hash))) return;
      }

      const answer = parseAnswer(msg);
      if (answer) opts.onAnswers?.([answer]);

      const offer = parseOffer(msg);
      if (offer) {
        offerSockets.set(offer.offerId, { socket, tracker });
        opts.onOffers?.([offer]);
      }

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

  const timer = setInterval(() => void announceAll(), opts.reAnnounceMs ?? 30_000);

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
      offerSockets.clear();
    },
    announce: announceAll,
  };
}
