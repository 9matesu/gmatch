/**
 * Wave 2 (D1): shareable node coordinate. A node's address travels between
 * humans as an opaque-looking config string (Session-style), and the app
 * decodes it locally. The string is NOT a security boundary (it carries the
 * address); its job is to keep raw host:port out of every UI surface —
 * display through maskedServerUrl, copy through the real string.
 */
import { maskIp } from './ipMask'

const HOST_RE = /^[A-Za-z0-9._-]{1,120}$/

export interface NodeCoord {
  host: string
  port: number | null
  name: string
}

export function encodeNodeMask(host: string, port: number | null, name: string): string | null {
  if (!HOST_RE.test(host) || !name || name.length > 40) return null
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
  const payload = btoa(JSON.stringify({ h: host, p: port ?? 0, n: name }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `gmatch://node/${payload}`
}

export function decodeNodeMask(s: string): NodeCoord | null {
  const m = s.trim().match(/^gmatch:\/\/node\/([A-Za-z0-9_-]+)$/)
  if (!m) return null
  try {
    const json = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))
    const v = JSON.parse(json) as { h?: unknown; p?: unknown; n?: unknown }
    if (typeof v.h !== 'string' || !HOST_RE.test(v.h)) return null
    if (typeof v.n !== 'string' || !v.n || v.n.length > 40) return null
    if (typeof v.p !== 'number' || !Number.isInteger(v.p) || v.p < 0 || v.p > 65535) return null
    return { host: v.h, port: v.p || null, name: v.n }
  } catch {
    return null
  }
}

/** How a node-mask's address renders anywhere a human looks at it. */
export function nodeMaskDisplayLabel(s: string): string {
  const c = decodeNodeMask(s)
  if (!c) return 'invalid node code'
  return maskIp(c.port ? `${c.host}:${c.port}` : c.host)
}
