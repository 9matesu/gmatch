// Pure decision helpers for the domination video popup window. Split from
// main.cjs so they run as plain node (same pattern as wallpaper-core.cjs):
// the window itself needs Electron, these rules do not.

/** Hard bounds for the autoplay window. Mirrors DOM_LIMITS.duration. Only a
 *  real number is clamped; any other type falls back to the default (IPC
 *  values that are not what the renderer contract says are not trusted). */
function clampDurationMs(ms) {
  const n = Number(ms)
  const min = 5000
  const max = 15 * 60_000
  if (typeof ms !== 'number' || !Number.isFinite(n)) return 60_000
  return Math.min(max, Math.max(min, n))
}

/** Only a direct https media URL may be opened in a window: no file:, no
 *  data:, no protocol-relative tricks. The renderer validates too; this is
 *  the privileged side. */
function validVideoUrl(url) {
  if (typeof url !== 'string') return null
  const s = url.trim()
  if (!s || s.length > 2048) return null
  if (!/^https:\/\//i.test(s)) return null
  return s
}

/** Player window size: 960x540 clamped to 85% of the work area, so a small
 *  display never spawns an off-screen window. */
function windowGeometry(workArea) {
  const wa = workArea || { width: 1920, height: 1080 }
  const width = Math.min(960, Math.floor(wa.width * 0.85))
  const height = Math.min(540, Math.floor(wa.height * 0.85))
  return { width: Math.max(320, width), height: Math.max(180, height) }
}

/** The player page (data: URL body). The url is https-validated upstream and
 *  attribute-escaped here; no scripts beyond the inline player, no node. */
function playerPageHtml(url) {
  const attr = String(url).replace(/&/g, '%26').replace(/"/g, '%22')
  return `<!doctype html><html><head><meta charset="utf-8"><title>gMatch</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain}button{position:fixed;top:8px;right:8px;z-index:2;background:#18181bcc;color:#fafafa;border:1px solid #3f3f46;border-radius:8px;padding:6px 10px;font:600 12px sans-serif;cursor:pointer}</style>
</head><body>
<button onclick="window.close()">Close</button>
<video src="${attr}" autoplay muted playsinline loop></video>
</body></html>`
}

/** data: URL for loadURL — encodeURIComponent keeps the document intact. */
function playerPageUrl(url) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(playerPageHtml(url))
}

module.exports = { clampDurationMs, validVideoUrl, windowGeometry, playerPageUrl }
