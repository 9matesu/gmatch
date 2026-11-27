// Pure helper that survived the decision-queue removal: the one predicate the
// image viewer still needs to tell a p2p-local object from a server row.
export function isP2pLocal(id: string): boolean {
  return typeof id === 'string' && id.startsWith('p2p-obj-')
}