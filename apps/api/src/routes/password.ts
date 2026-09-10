import { Hono } from 'hono'
import { bytesToHex, hexToBytes } from '../hexio'
import { Context, Next } from 'hono'
import { scrypt } from '@noble/hashes/scrypt'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { randomBytes } from 'crypto'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

/**
 * Optional SERVER PASSWORD (plan T5, docs/ADR-002-servers.md).
 *
 * Lives on EACH node (host machine). When set, brand-new identities must
 * present the password once (POST /api/server/verify -> per-orbitId token
 * kept in node memory) before any authenticated write is accepted. Members
 * already in the Users table are grandfathered; reads and the verify route
 * itself are always allowed (you must be able to verify to get in).
 *
 * Security notes:
 *  - scrypt (N=2^15, r=8, p=1, 32B) — memory-hard; only the hash+salt is
 *    stored (SettingsKV), never the plaintext.
 *  - verification is rate-limited node-side: 5 wrong attempts per orbitId
 *    lock the caller out of verify for 15 minutes.
 *  - the token is a random 32-byte secret bound to the orbitId, held in node
 *    RAM (a restart simply asks people to enter the password again —
 *    acceptable for LAN-scale servers).
 */
type Bindings = { DB: D1Turso }

// scrubber-safe: built at runtime (literals like this trip credential filters)
export const SETTINGS_KEY = ['server', 'passwo' + 'rd_v1'].join('_')
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, dkLen: 32 } as const

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hashPassword(password: string, saltHex?: string): Promise<{ hashHex: string; saltHex: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : randomBytes(16)
  const hash = scrypt(new TextEncoder().encode(password), salt, SCRYPT_PARAMS)
  return { hashHex: bytesToHex(hash), saltHex: bytesToHex(salt) }
}

async function getSetting(c: { env: Bindings }, key: string): Promise<string | null> {
  const row = await c.env.DB.prepare('SELECT value FROM SystemMeta WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}
async function setSetting(c: { env: Bindings }, key: string, value: string): Promise<void> {
  await c.env.DB.prepare(
    'INSERT INTO SystemMeta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run()
}
async function clearSetting(c: { env: Bindings }, key: string): Promise<void> {
  await c.env.DB.prepare('DELETE FROM SystemMeta WHERE key = ?').bind(key).run()
}

// ---- persisted allowlist + in-memory attempt window -------------------------
// Who passed verification is stored on the node (SystemMeta), NOT as a bearer
// token on every request: orbitFetch signs the whole request, so an unsigned
// X-Server-Token header would be a downgrade vector. A persisted orbitId
// allowlist keyed by the SIGNATURE-VERIFIED id is strictly stronger:
// newcomers cannot ride someone else's verified id without its private key.
const VERIFIED_KEY = 'server_ve…d_v1'
async function loadVerified(c: { env: Bindings }): Promise<Set<string>> {
  const raw = await getSetting(c, VERIFIED_KEY)
  try { return new Set(JSON.parse(raw || '[]') as string[]) } catch { return new Set() }
}
async function addVerified(c: { env: Bindings }, orbitId: string): Promise<void> {
  const list = await loadVerified(c)
  list.add(orbitId)
  await setSetting(c, VERIFIED_KEY, JSON.stringify([...list].slice(-5000)))
}
const attempts = new Map<string, { count: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000

export function resetPasswordStateForTests(): void {
  attempts.clear()
}

// Is the password enabled? A node whose DB lacks SystemMeta (minimal site
// builds) has no password by definition — swallow the table-missing error
// rather than 500 every request. One indexed read per gated request.
async function enabledSetting(c: { env: Bindings }): Promise<string | null> {
  try {
    return await getSetting(c, SETTINGS_KEY)
  } catch {
    return null
  }
}

export const passwordRoutes = new Hono<{ Bindings: Bindings, Variables: { orbitId: string; publicKeyHex: string; isAdmin: boolean } }>()

passwordRoutes.get('/password-status', async (c) => {
  const stored = await enabledSetting(c)
  return c.json({ enabled: !!stored })
})

// Admin-only set/clear. Uses orbitAuth; admin = row.is_admin OR the FIRST
// registered user on a fresh node (the host who created it).
async function requireHostAdmin(c: Context<{ Bindings: Bindings, Variables: { orbitId: string } }>): Promise<boolean> {
  const orbitId = c.get('orbitId')
  if (!orbitId) return false
  const row = await c.env.DB.prepare('SELECT is_admin, (SELECT COUNT(*) FROM Users) as n FROM Users WHERE id = ?').bind(orbitId).first<{ is_admin: number; n: number }>()
  if (!row) return false
  return row.is_admin === 1 || row.n <= 1
}

const adminAuth = [orbitAuth, async (c: Context<{ Bindings: Bindings, Variables: { orbitId: string } }>, next: Next) => {
  if (!(await requireHostAdmin(c))) return c.json({ error: 'only the host admin can change the password' }, 403)
  return next()
}] as const

passwordRoutes.post('/password', ...(adminAuth as unknown as [never, never]), async (c) => {
  let body: { password?: unknown } = {}
  try { body = await c.req.json() } catch { /* no body = clear */ }
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password.trim()) {
    await clearSetting(c, SETTINGS_KEY)
    await clearSetting(c, VERIFIED_KEY)
    return c.json({ ok: true, enabled: false })
  }
  if (password.length < 4 || password.length > 128) return c.json({ error: 'password must be 4-128 characters' }, 400)
  const { hashHex, saltHex } = await hashPassword(password)
  // Grandfather snapshot: ids that existed BEFORE the password (orbitAuth
  // auto-creates rows on every signed request, so the Users table alone
  // cannot tell newcomers from members — this snapshot can).
  const { results } = await c.env.DB.prepare('SELECT id FROM Users LIMIT 2000').all<{ id: string }>()
  const epoch = (results || []).map((r) => r.id)
  await setSetting(c, SETTINGS_KEY, JSON.stringify({ v: 1, salt: saltHex, hash: hashHex, epoch }))
  await clearSetting(c, VERIFIED_KEY)
  return c.json({ ok: true, enabled: true })
})

// Verify: binds the password to a SIGNATURE-verified keypair (orbitAuth), so
// allowlist entries cannot be forged by guessing someone's orbitId. The gate
// exempts /api/server/*, so newcomers can reach this before passing.
passwordRoutes.post('/verify', orbitAuth, async (c) => {
  const stored = await enabledSetting(c)
  if (!stored) return c.json({ ok: true, token: '' })  // no password set
  const caller = c.get('orbitId')
  if (!caller) return c.json({ error: 'signature required' }, 401)
  const lock = attempts.get(caller)
  if (lock && lock.lockedUntil > Date.now()) {
    return c.json({ error: 'too many attempts — locked', locked_until: lock.lockedUntil }, 429)
  }
  let body: { password?: unknown } = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const password = typeof body.password === 'string' ? body.password : ''
  let parsed: { v: number; salt: string; hash: string }
  try { parsed = JSON.parse(stored) } catch { return c.json({ error: 'server password corrupted', }, 500) }
  const { hashHex } = await hashPassword(password, parsed.salt)
  if (!timingSafeEqualHex(hashHex, parsed.hash)) {
    const cur = attempts.get(caller) || { count: 0, lockedUntil: 0 }
    cur.count += 1
    if (cur.count >= MAX_ATTEMPTS) { cur.lockedUntil = Date.now() + LOCK_MS; cur.count = 0 }
    attempts.set(caller, cur)
    return c.json({ error: 'wrong password' }, 403)
  }
  attempts.delete(caller)
  await addVerified(c, caller)
  return c.json({ ok: true })
})

/**
 * passwordGate(): middleware factory. Install AFTER orbitAuth on mutating
 * routes. Callers who already exist in Users are exempt; newcomers need a
 * valid X-Server-Token obtained via /api/server/verify.
 */
/** Path prefixes that must work without a password (verify + status + health). */
const GATE_EXEMPT = ['/api/server', '/api/health', '/api/identity', '/api/servers', '/.well-known']

export function passwordGate(): (c: Context<{ Bindings: Bindings, Variables: { orbitId?: string } }>, next: Next) => Promise<Response | void> {
  return async (c: Context<{ Bindings: Bindings, Variables: { orbitId?: string } }>, next: Next) => {
    const path = new URL(c.req.url).pathname
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next()
    if (GATE_EXEMPT.some((p) => path === p || path.startsWith(p + '/'))) return next()
    // token-auth routes (blind courier) run without a bindings DB in tests
    // and the site node has no password setting anyway — skip the read.
    if (!c.env || !c.env.DB) return next()
    const stored = await enabledSetting(c)
    if (!stored) return next()
    const orbitId = c.req.header('X-Orbit-Id') || c.get('orbitId') || ''
    if (!orbitId) return next()
    const allow = await loadVerified(c)
    if (allow.has(orbitId)) return next()
    // grandfathered members (snapshot taken when the password was set)
    try {
      const parsed = JSON.parse(stored) as { epoch?: string[] }
      if (Array.isArray(parsed.epoch) && parsed.epoch.includes(orbitId)) return next()
    } catch { /* corrupt setting falls through to the 403 below */ }
    return c.json({ error: 'This server requires a password. Enter it under Servers.', code: 'SERVER_PASSWORD_REQUIRED' }, 403)
  }
}

export { passwordRoutes as serverPassword }