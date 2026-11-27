"use client";

import { getLocalObject } from './p2pSwarm'
import { vaultProbe } from '../services/vault'
import { isRequestableObjectId, resolveObjectRefId } from './objectRef'

/**
 * Bytes this device already holds for a content-addressed object, as a
 * renderable URL. The resolution order mirrors useObjectImage's own ladder
 * (encrypted vault → swarm/IndexedDB store) and touches NO network: callers
 * fall back to their signed node fetch when this returns null.
 *
 * A `/api/objects/<id>` URL, a bare id, or a `urn:sha256:<…>` descriptor
 * resolves to the same id. Magnets are descriptors, not ids: never
 * requestable. The vault hit returns its Range-capable loopback URL; the
 * swarm store hit returns a fresh blob URL (the CALLER owns revoking it).
 *
 * The ref → id mapping lives in utils/objectRef.ts. This used to carry its
 * own UUID-only regex, so a 64-hex `urn:sha256:<hash>` descriptor silently
 * missed the local copy even when this device held the bytes.
 */
export async function localHeldMediaUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null
  const id = resolveObjectRefId(ref)
  if (!id || !isRequestableObjectId(id)) return null
  try {
    const probe = await vaultProbe(id)
    if (probe.state === 'local' && probe.local) return probe.local
  } catch {
    /* no vault bridge (browser dev) — fall through */
  }
  try {
    const blob = await getLocalObject(id)
    if (blob) return URL.createObjectURL(blob)
  } catch {
    /* store unavailable */
  }
  return null
}
