// Local mesh labels (plan 1.5.6 P1). A label is DEVICE-LOCAL UI grouping —
// it is not a network, not discoverable, and confers no authority over any
// peer. Membership = local curation of known peer ids; invites = plain node
// codes (addresses, not secrets). Never trust these lists remotely.
export interface LocalMeshLabel {
  id: string
  name: string
  ownerOrbitId: string
  createdAt: string
  memberOrbitIds: string[]
  nodeCodes: string[]
}

export const MESH_LABELS_KEY = 'gmatch.meshLabels.v1'

export function shortOwner(id: string): string {
  return (id || '').slice(0, 8)
}

export function createLabel(name: string, ownerOrbitId: string): LocalMeshLabel {
  const clean = String(name || '').trim().slice(0, 40) || 'My mesh'
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return {
    id,
    name: clean,
    ownerOrbitId,
    createdAt: new Date().toISOString(),
    memberOrbitIds: [],
    nodeCodes: [],
  }
}

export function readLabels(): LocalMeshLabel[] {
  try {
    const raw = localStorage.getItem(MESH_LABELS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((l) =>
      l && typeof l.id === 'string' && typeof l.name === 'string' && typeof l.ownerOrbitId === 'string'
    )
  } catch {
    return []
  }
}

export function writeLabels(labels: LocalMeshLabel[]): void {
  try { localStorage.setItem(MESH_LABELS_KEY, JSON.stringify(labels.slice(0, 50))) } catch { /* quota */ }
}

/** Remove a peer from MY local view only — never a remote revocation. */
export function removeMemberLocal(labels: LocalMeshLabel[], labelId: string, peerId: string): LocalMeshLabel[] {
  return labels.map((l) =>
    l.id !== labelId ? l : { ...l, memberOrbitIds: l.memberOrbitIds.filter((m) => m !== peerId) }
  )
}

export function isOwnLabel(label: LocalMeshLabel, orbitId?: string | null): boolean {
  return Boolean(orbitId) && label.ownerOrbitId === orbitId
}
