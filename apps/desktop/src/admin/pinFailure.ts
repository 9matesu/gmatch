/**
 * Explaining an admin passcode failure.
 *
 * The console showed the server's raw error string, and the three ways this
 * actually fails are indistinguishable from it:
 *
 *   401  the passcode is wrong, OR this identity is not the allowlisted
 *        ADMIN_ORBIT_ID on that node
 *   404  the node does not run the admin service at all (a courier-only node
 *        answers SITE_SERVICES=mail,turn, and /api/admin/* is not routed)
 *   503  the node has no ADMIN_PIN and no ADMIN_PIN_HASH, so there is nothing
 *        to compare the passcode against
 *
 * All three used to surface as one unhelpful line, so a correct passcode on a
 * misconfigured node looked exactly like a wrong passcode. Naming the node and
 * the status is the difference between a two-minute fix and an afternoon of
 * guessing.
 */

/** Kept short enough to read in a toast. */
export function describePinFailure(status: number, serverError?: string | null, baseUrl?: string | null): string {
  const node = baseUrl ? baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '') : 'this node'
  switch (status) {
    case 404:
      return `${node} does not run the admin service — the passcode cannot be checked there. Point the app at a full node, or add "admin" to that node's SITE_SERVICES.`;
    case 503:
      return `${node} has no admin passcode configured. Set ADMIN_PIN (or ADMIN_PIN_HASH) on that node and restart it.`;
    case 401:
      return `Wrong passcode for ${node}. If it is right, that node restricts admin to a single ADMIN_ORBIT_ID and this account is not it.`;
    case 429:
      return `Too many failed attempts. Wait 15 minutes, then try ${node} again.`;
    case 403:
      return `${node} accepted the passcode but refused this account. The admin grant may have expired — re-enter the passcode.`;
    default:
      return serverError?.trim() || `Admin passcode check failed on ${node} (HTTP ${status}).`;
  }
}
