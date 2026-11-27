export type LinkToken = {
  type: 'text' | 'url'
  value: string
}

/**
 * Only these schemes may become a clickable anchor.
 *
 * The tokenizer used to accept `tg://` verbatim and to turn any `www.` token
 * into an `http://` link. A URL that reaches an <a href> is a scheme the browser
 * may act on, not just text: `javascript:` / `vbscript:` / `data:text/html` are
 * all executable, and a peer-authored post is exactly the untrusted input that
 * should never be able to hand the player one.
 *
 * http + https are the whole allowlist on purpose: it is what a share link
 * actually is, and anything else degrades to inert text rather than a live sink.
 */
const SAFE_SCHEME = /^https?:\/\//i

const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/

/** Normalize a matched URL token: trim trailing punctuation and ensure a scheme. */
function normalizeUrl(raw: string): { display: string; href: string } | null {
  const trimmed = raw.replace(TRAILING_PUNCTUATION, '')
  if (!trimmed) return null
  // `www.example.com` -> `http://www.example.com`; an already-schemed token is
  // kept only when it is http(s) (the pattern can only match http(s) or www.,
  // so this is the assertion that keeps the invariant local).
  const href = SAFE_SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`
  if (!SAFE_SCHEME.test(href)) return null
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

/** True if the text contains at least one link that may be rendered as an anchor. */
export function containsUrl(text: string): boolean {
  return tokenizeUrls(text).some((t) => t.type === 'url')
}