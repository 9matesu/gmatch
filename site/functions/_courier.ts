/**
 * Shared guts of the blind rendezvous. Not a route: files starting with `_`
 * are ignored by Pages Functions routing.
 *
 * What lives here is the minimum: sealed envelopes (a mailbox) and directory
 * rows (a name + an address). No profile, no post, no presence, no media — the
 * host can read none of it because none of it is here.
 */

export interface Env {
  MAIL: KVNamespace
}

export type Envelope = {
  v?: number
  kind?: string
  to?: string
  id?: string
  sealed?: string
  exp?: number
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

export const MAIL_TTL_SECONDS = 120
export const MAIL_BOX_MAX = 50
export const DIRECTORY_MAX = 100
export const STALE_MS = 24 * 60 * 60 * 1000
export const TOKEN_RE = /^[0-9a-f]{16,128}$/i

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

export const preflight = () => new Response(null, { status: 204, headers: CORS })

export function readBody<T>(req: Request): Promise<T | null> {
  return req.json().then((v) => v as T).catch(() => null)
}

export async function readBox(kv: KVNamespace, token: string): Promise<Envelope[]> {
  const raw = await kv.get(`mail:${token}`)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Envelope[]) : []
  } catch {
    return []
  }
}

export async function writeBox(kv: KVNamespace, token: string, box: Envelope[]): Promise<void> {
  await kv.put(`mail:${token}`, JSON.stringify(box), { expirationTtl: MAIL_TTL_SECONDS })
}

export type DirectoryRow = {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required?: number
  endpoint_hint?: string
  is_private?: number
  tags?: string[]
  user_count?: number | null
  online_count?: number | null
  last_seen?: string
}

export async function readDirectory(kv: KVNamespace): Promise<DirectoryRow[]> {
  const raw = await kv.get('servers')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DirectoryRow[]) : []
  } catch {
    return []
  }
}

export async function writeDirectory(kv: KVNamespace, rows: DirectoryRow[]): Promise<void> {
  await kv.put('servers', JSON.stringify(rows.slice(0, DIRECTORY_MAX)))
}

export function fresh(rows: DirectoryRow[]): DirectoryRow[] {
  const cutoff = Date.now() - STALE_MS
  return rows.filter((r) => !r.last_seen || Date.parse(r.last_seen) >= cutoff)
}

/** Shallow copy of a request body's own JSON, never a cast of `any`. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}