/**
 * Thumbnail URLs for the local picture cache.
 *
 * `gmcache://f/<key>` serves the encrypted original at full size. A gallery
 * of full-size boorus is hundreds of megabytes of DECODED bitmaps — the
 * single biggest memory/CPU cost in the app. `gmcache://thumb/<key>` serves a
 * small JPEG that the main process generates on demand (Electron's built-in
 * `nativeImage`), so a dense grid decodes a few hundred kilobytes per tile
 * instead of several megabytes.
 *
 * Only the local cache has a thumbnailer. A remote URL is returned unchanged:
 * there is no server-side resizer, and pretending otherwise would 404.
 */
export function thumbUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  if (!url.startsWith('gmcache://')) return url
  if (url.startsWith('gmcache://thumb/')) return url
  // Swap the host segment (usually 'f'); the key stays the same.
  return url.replace(/^gmcache:\/\/[^/]+/, 'gmcache://thumb')
}
