// One builder for the human-shareable node code (Servers hero + directory
// rows). Wraps encodeNodeMask; input is a lanUrl ('http://h:p') or bare hint.
import { encodeNodeMask } from './nodeMask'

export function buildNodeCode(address: string, name: string): string | null {
  const trimmedName = String(name || '').trim().slice(0, 40)
  if (!trimmedName) return null
  const trimmed = String(address || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  // The host charset rejects spaces/paths already; guard the obvious junk here.
  if (!trimmed || /\s/.test(trimmed)) return null
  const colon = trimmed.lastIndexOf(':')
  const maybePort = colon > 0 ? trimmed.slice(colon + 1) : ''
  const hasPort = /^\d{1,5}$/.test(maybePort)
  const host = hasPort ? trimmed.slice(0, colon) : trimmed
  const port = hasPort ? Number(maybePort) : null
  return encodeNodeMask(host, port, trimmedName)
}
