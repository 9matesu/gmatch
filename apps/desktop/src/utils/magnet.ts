/**
 * Canonical WebTorrent / BitTorrent Magnet URI helpers
 */

export const PUBLIC_WEBTORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
]

export function isMagnetUri(url?: string | null): boolean {
  if (!url) return false
  return url.trim().toLowerCase().startsWith('magnet:?')
}

export function getInfoHashFromMagnet(magnetUri?: string | null): string | null {
  if (!isMagnetUri(magnetUri)) return null
  const match = /[?&]xt=urn:btih:([0-9a-fA-F]{40}|[2-7a-zA-Z]{32})/i.exec(magnetUri!)
  return match ? match[1].toLowerCase() : null
}

export function buildMagnetUri(infoHash: string, displayName?: string): string {
  const cleanHash = infoHash.trim().toLowerCase()
  let uri = `magnet:?xt=urn:btih:${cleanHash}`
  if (displayName) {
    uri += `&dn=${encodeURIComponent(displayName.trim())}`
  }
  for (const tr of PUBLIC_WEBTORRENT_TRACKERS) {
    uri += `&tr=${encodeURIComponent(tr)}`
  }
  return uri
}
