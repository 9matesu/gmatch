"use client";

import { getLocalObject } from './p2pSwarm'
import { vaultProbe } from '../services/vault'
import { isRequestableObjectId, normalizeCardId } from '../hooks/useObjectImage'

/**
 * Bytes this device already holds for a content-addressed object, as a
 * renderable URL. The resolution order mirrors useObjectImage's own ladder
 * (encrypted vault → swarm/IndexedDB store) and touches NO network: callers
 * fall back to their signed node fetch when this returns null.
 *
 * A `/api/objects/<id>` URL, a bare id, or a `urn:sha256:<uuid>` descriptor —
 * the same ref shapes the hook accepts — resolve to the same id. Magnets are
 * descriptors, not ids: never requestable. The vault hit returns its
 * Range-capable loopback URL; the swarm store hit returns a fresh blob URL
 * (the CALLER owns revoking it).
 */
export async function localHeldMediaUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null
  const urnMatch = ref.trim().match(/^urn:sha256:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  const id = normalizeCardId(urnMatch ? `/api/objects/${urnMatch[1]}` : ref)
  if (!isRequestableObjectId(id)) return null
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
