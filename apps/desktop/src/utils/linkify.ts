export type LinkToken = {
  type: 'text' | 'url'
  value: string
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|tg:\/\/[^\s<>"']+)/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|ogg|m4v)(\?.*)?$/i

/** True if a normalized URL points directly at an image/video asset. */
export function isMediaUrl(url: string): boolean {
  return MEDIA_EXT.test(url.split('?')[0])
}

/** Normalize a matched URL token: trim trailing punctuation and ensure a scheme. */
function normalizeUrl(raw: string): { display: string; href: string } | null {
  const trimmed = raw.replace(TRAILING_PUNCTUATION, '')
  if (!trimmed) return null
  let href = trimmed
  if (/^tg:\/\//i.test(href)) {
    return { display: trimmed, href }
  }
  if (!/^https?:\/\//i.test(href)) href = `http://${href}`
  return { display: trimmed, href }
}

/** Split free-form text into plain-text and URL segments (safe to render as React nodes). */
export function tokenizeUrls(text: string): LinkToken[] {
  const tokens: LinkToken[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0]
    const index = match.index ?? 0
    const normalized = normalizeUrl(raw)
    if (normalized) {
      if (index > lastIndex) {
        tokens.push({ type: 'text', value: text.slice(lastIndex, index) })
      }
      tokens.push({ type: 'url', value: normalized.href })
      lastIndex = index + raw.length
    }
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', value: text }]
}

/** True if the text contains at least one URL. */
export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text)
}