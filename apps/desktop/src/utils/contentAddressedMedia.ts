"use client";

import { getLocalObject, requestSwarmObject, sha256HexBlob } from './p2pSwarm'

/**
 * Content-addressed media ladder (roadmap L4 — a peer post's own bytes).
 *
 * A peer-replicated post names TWO things: the object id its row is addressed
 * by (`/api/objects/<objectId>`) and the sha256 of the bytes it describes
 * (`contentCid`, carried in the signed operation manifest). Only the hash is
 * proof of what the bytes ARE — the object id is an alias the author chose.
 *
 * Resolving a row through its content hash is what makes a peer post
 * independent of any node:
 *
 *   1. bytes held locally under the object id, hash-verified;
 *   2. bytes held locally under the content hash, hash-verified;
 *   3. the swarm, asked for the content hash with `expectedHash`, which the
 *      engine verifies before it resolves (and which also answers from its own
 *      store when the bytes are already there);
 *   4. the swarm, asked for the object id with the SAME expectation — a peer
 *      that only ever advertised the alias still serves bytes we can verify.
 *
 * There is deliberately no `/api/objects` step: a row that states its content
 * is fetched from its content (§12b: media lives with the peers, the node is
 * not the media source). A row with no content hash keeps the legacy ladder in
 * `useObjectImage` exactly as it was.
 *
 * Nothing here claims more than it proved: bytes that do not hash to the
 * expected value are never returned, from disk or from a peer.
 */

export interface ContentAddressedDeps {
  /** Durable/RAM local bytes by id (vault first, then IndexedDB). */
  readLocal(id: string): Promise<Blob | null>
  /** Ask the swarm; `expectedHash` makes the engine reject wrong bytes. */
  requestSwarm(id: string, timeoutMs: number, opts: { expectedHash: string }): Promise<Blob>
  /** sha256 of bytes as lowercase hex. */
  hash(blob: Blob): Promise<string>
}

export interface ContentAddressedOptions {
  /** Swarm ask budget per id (default 5s, matching the tile's own window). */
  timeoutMs?: number
  /** Test seam: replace one or more leaf operations. */
  deps?: Partial<ContentAddressedDeps>
}

/** One bound for a tile's peer fetch, same as the legacy 404 fallback. */
export const PEER_MEDIA_TIMEOUT_MS = 5000

const SHA256_HEX = /^[0-9a-f]{64}$/i

/** A value usable as a content address (sha256 hex). */
export function isContentHash(value: string | null | undefined): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value)
}

const defaultDeps: ContentAddressedDeps = {
  readLocal: (id) => getLocalObject(id),
  requestSwarm: (id, timeoutMs, opts) => requestSwarmObject(id, timeoutMs, opts),
  hash: (blob) => sha256HexBlob(blob),
}

async function verified(deps: ContentAddressedDeps, id: string | null, expected: string): Promise<Blob | null> {
  if (!id) return null
  let blob: Blob | null = null
  try {
    blob = await deps.readLocal(id)
  } catch {
    return null
  }
  if (!blob) return null
  try {
    return (await deps.hash(blob)) === expected ? blob : null
  } catch {
    return null
  }
}

/**
 * The bytes this node can honestly serve for `contentHash`, or `null`.
 *
 * `objectId` is optional and only ever an alias: it is tried first because a
 * local post registers its bytes under both keys, so the common case costs one
 * lookup. Every path that returns bytes has verified them against the hash.
 */
export async function resolveContentAddressedMedia(
  objectId: string | null,
  contentHash: string,
  options: ContentAddressedOptions = {},
): Promise<Blob | null> {
  if (!isContentHash(contentHash)) return null
  const expected = contentHash.toLowerCase()
  const deps: ContentAddressedDeps = { ...defaultDeps, ...options.deps }
  const timeoutMs = options.timeoutMs ?? PEER_MEDIA_TIMEOUT_MS
  const alias = objectId && objectId !== expected ? objectId : null

  const local = (await verified(deps, alias, expected)) ?? (await verified(deps, expected, expected))
  if (local) return local

  const fromSwarm = async (id: string): Promise<Blob | null> => {
    try {
      return await deps.requestSwarm(id, timeoutMs, { expectedHash: expected })
    } catch {
      // A timeout, an offer-less peer, a chunk that failed its AEAD check or
      // bytes that hashed differently all land here: the tile says so instead
      // of rendering bytes nobody vouched for.
      return null
    }
  }

  const byHash = await fromSwarm(expected)
  if (byHash) return byHash
  return alias ? fromSwarm(alias) : null
}