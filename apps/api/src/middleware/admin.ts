import { Context, Next } from 'hono'

export async function adminAuth(c: Context, next: Next) {
  const orbitId = c.get('orbitId')
  if (!orbitId) return c.json({ error: 'Not authenticated' }, 401)

  const row = (await c.env.DB.prepare('SELECT is_admin FROM Users WHERE id = ?').bind(orbitId).first()) as { is_admin: number } | null
  if (!row || !row.is_admin) return c.json({ error: 'Forbidden' }, 403)

  await next()
}
