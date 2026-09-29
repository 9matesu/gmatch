// Node-side reader for shared/sources.json — the single source of truth for
// every booru origin (see src/services/booruSources.ts for the renderer view).
//
// Resolved at RUNTIME, not require()d, for the same reason as blocklist.json:
// in packaged builds it ships as extraResources, and a relative require from
// inside app.asar would escape the archive.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function loadRegistry(app) {
  const p = app && app.isPackaged
    ? path.join(process.resourcesPath, 'shared', 'sources.json')
    : path.join(__dirname, '..', '..', '..', 'shared', 'sources.json')
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    const sources = Array.isArray(parsed.sources) ? parsed.sources.filter((s) => s && s.enabled !== false) : []
    return { sources, byteHosts: Array.isArray(parsed.byteHosts) ? parsed.byteHosts : [] }
  } catch (err) {
    // A missing registry must not brick the feed: log loudly and hand back an
    // empty list, which surfaces as "no sources configured" rather than a crash.
    try { console.error(`[booru-registry] failed to read sources.json: ${err?.message || err}`) } catch { /* ignore */ }
    return { sources: [], byteHosts: [] }
  }
}

function originHost(origin) {
  try { return new URL(origin).hostname } catch { return '' }
}

/**
 * Referer a host requires. Registry `referer` wins; booru.org mirrors share the
 * parent referer (their CDN fronts subdomains); everything else gets its own
 * origin. This replaces the hand-written hostname chain that was duplicated
 * across main.cjs, imageCache.cjs, vite.config.ts and imageCache.ts.
 */
function refererFor(hostname, sources) {
  for (const s of sources) {
    if (!s.referer) continue
    if (originHost(s.origin) === hostname) return s.referer
    for (const h of s.imageHosts || []) {
      if (h === hostname) return s.referer
    }
    if (s.mediaOrigin && originHost(s.mediaOrigin) === hostname) return s.referer
    if (s.apiOrigin && originHost(s.apiOrigin) === hostname) return s.referer
  }
  return `https://${hostname}/`
}

module.exports = { loadRegistry, refererFor, originHost }
