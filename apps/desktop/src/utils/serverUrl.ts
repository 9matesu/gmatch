// Renderer-side server URL validation (mirror of electron/server-mode-core.cjs
// which runs in the CJS main process; kept in sync by the shared test file).
const SERVER_URL_RE = /^https?:\/\/[\w.-]+(?::\d{1,5})?(?:\/.*)?$/

export function isServerUrl(v: unknown): v is string {
  return typeof v === 'string' && SERVER_URL_RE.test(v)
}

export function normalizeServerUrl(v: string): string | null {
  return isServerUrl(v) ? v.replace(/\/+$/, '') : null
}

/** True when a directory row's endpoint_hint points at the node we are on. */
export function isCurrentServerUrl(base: string, hint: string): boolean {
  const norm = (u: string) => u.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  const b = norm(base)
  return !!b && !!hint && norm(hint) === b
}
