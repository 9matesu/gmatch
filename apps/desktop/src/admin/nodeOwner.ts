/** The Admin entry is a UI affordance, not the security boundary: verify-pin
 *  (scrypt hash + identity binding + lockout) is. Only the install's recorded
 *  owner identity gets the affordance — a switched-in account never does. */
export function isNodeOwner(
  identityOrbitId: string | null | undefined,
  nodeOwnerId: string | null | undefined,
): boolean {
  return Boolean(identityOrbitId && nodeOwnerId && identityOrbitId === nodeOwnerId)
}
