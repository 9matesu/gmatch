import { Context, Next } from 'hono'

/** Wave 2 (E3): an admin grant expires after 12h — the PIN must be re-entered
 * to continue. is_admin alone (a permanent column flip from one unlock) is
 * too long a leash for a shared node. */
export const ADMIN_GRANT_TTL_MS = 12 * 60 * 60 * 1000
export const ADMIN_GRANT_KEY = 'admin_grant_at'

export async function adminAuth(c: Context, next: Next) {
  const orbitId = c.get('orbitId')
  if (!orbitId) return c.json({ error: 'Not authenticated' }, 401)

  const row = (await c.env.DB.prepare('SELECT is_admin FROM Users WHERE id = ?').bind(orbitId).first()) as { is_admin: number } | null
  if (!row || !row.is_admin) return c.json({ error: 'Forbidden' }, 403)

  const meta = await c.env.DB.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(ADMIN_GRANT_KEY).first<{ value: string | null }>()
  // A grant stamped by verify-pin expires; a bare is_admin=1 (self-host
  // bootstrap or direct DB write) has no stamp and stays — whoever can write
  // the DB already owns the node, so there is nothing to defend there.
  if (meta?.value) {
    const grantedAt = Number(meta.value)
    if (!grantedAt || Date.now() - grantedAt > ADMIN_GRANT_TTL_MS) {
      return c.json({ error: 'Admin grant expired. Re-enter the passcode.' }, 403)
    }
  }

  await next()
}
