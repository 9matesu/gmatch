/**
 * PEX — peer exchange, the layer that makes a tracker optional after the first
 * hop. A knows B, B knows C: A learns C from B.
 *
 * Rules that keep it from being a gossip storm:
 *  - at most MAX_PEERS (32) entries per table, newest first;
 *  - a peer is only forwarded after we have talked to it (a verified HELLO), so
 *    a malicious tracker cannot poison the table with random ids;
 *  - one PEX per PEER_INTERVAL_MS per peer.
 */

export const MAX_PEERS = 32;
export const PEER_INTERVAL_MS = 60_000;

export interface MeshPeer {
  orbitId: string;
  /** Node the peer lives on, when the beacon said one. */
  nodeUrl?: string;
  /** The peer's Ed25519 public key, from the signed HELLO. */
  pubKeyHex?: string;
  /** The peer's X25519 encryption public key, from the signed HELLO. */
  encPubHex?: string;
  /** Last time we verified it (ms). */
  at: number;
}

export interface PexTable {
  peers: MeshPeer[];
  /** orbitId -> last time we sent it a PEX. */
  sentAt: Map<string, number>;
  /** orbitIds we have verified this session. */
  verified: Set<string>;
}

export function createPexTable(): PexTable {
  return { peers: [], sentAt: new Map(), verified: new Set() };
}

const ORBIT_RE = /^[0-9a-f]{64}$/;
/** Ed25519 and X25519 public keys are both 32 bytes = 64 hex chars. */
const KEY_RE = /^[0-9a-f]{64}$/;

function validPeer(value: unknown): MeshPeer | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.orbitId !== 'string' || !ORBIT_RE.test(row.orbitId)) return null;
  const nodeUrl = typeof row.nodeUrl === 'string' && /^https?:\/\//i.test(row.nodeUrl) ? row.nodeUrl : undefined;
  const pubKeyHex = typeof row.pubKeyHex === 'string' && KEY_RE.test(row.pubKeyHex) ? row.pubKeyHex : undefined;
  const encPubHex = typeof row.encPubHex === 'string' && KEY_RE.test(row.encPubHex) ? row.encPubHex : undefined;
  const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : Date.now();
  return { orbitId: row.orbitId, nodeUrl, pubKeyHex, encPubHex, at };
}

/** Add one verified peer. Returns false when the id is already known. */
export function addPeer(table: PexTable, peer: MeshPeer): boolean {
  const clean = validPeer(peer);
  if (!clean) return false;
  if (table.verified.has(clean.orbitId)) return false;
  table.verified.add(clean.orbitId);
  table.peers = [clean, ...table.peers.filter((p) => p.orbitId !== clean.orbitId)].slice(0, MAX_PEERS);
  return true;
}

/**
 * Build a PEX payload for one peer. Only verified peers, and only when the
 * interval elapsed — a flapping link must not become a peer storm.
 */
export function buildPex(table: PexTable, forPeerId: string, now: number = Date.now()): MeshPeer[] | null {
  const last = table.sentAt.get(forPeerId) ?? 0;
  if (now - last < PEER_INTERVAL_MS) return null;
  table.sentAt.set(forPeerId, now);
  return table.peers.filter((p) => p.orbitId !== forPeerId).slice(0, MAX_PEERS);
}

/** Ingest a PEX from a verified peer. Unverified senders are ignored. */
export function ingestPex(table: PexTable, fromPeerId: string, raw: unknown): number {
  if (!table.verified.has(fromPeerId)) return 0;
  const list = Array.isArray((raw as { peers?: unknown[] })?.peers) ? (raw as { peers: unknown[] }).peers : [];
  let added = 0;
  for (const item of list.slice(0, MAX_PEERS)) {
    const peer = validPeer(item);
    if (!peer || peer.orbitId === fromPeerId) continue;
    if (addPeer(table, peer)) added++;
  }
  return added;
}

/** Drop peers we have not re-verified for a while (a restarted node is new). */
export function prunePex(table: PexTable, maxAgeMs = 6 * 60 * 60 * 1000, now: number = Date.now()): number {
  const before = table.peers.length;
  table.peers = table.peers.filter((p) => now - p.at <= maxAgeMs);
  for (const id of [...table.verified]) {
    if (!table.peers.some((p) => p.orbitId === id)) table.verified.delete(id);
  }
  return before - table.peers.length;
}

/** Wire shape (the protocol layer narrows it again on receipt). */
export interface PexMessage {
  type: 'SWARM_PEX';
  peers: MeshPeer[];
}

export function encodePex(peers: MeshPeer[]): PexMessage {
  return { type: 'SWARM_PEX', peers: peers.slice(0, MAX_PEERS) };
}