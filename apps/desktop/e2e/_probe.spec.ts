import { test, chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

/** Probe: what does the 122ms frame consist of? Bisect by disabling a layer. */
test('prod frame bisect', async () => {
  const DIST = join(process.cwd(), 'dist')
  const MIME: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json',
  }
  const posts = Array.from({ length: 500 }, (_, i) => ({
    id: `bench-${i}`, author_id: `bench-author-${i % 7}`, author_name: `B${i % 7}`,
    url: `/bench/p${i}.jpg`, mime_type: 'image/jpeg', caption: `Synthetic post ${i}`,
    created_at: new Date(1700000000000 + i * 1000).toISOString(), like_count: i % 13, comment_count: 0,
  }))

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/posts') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ posts })); return
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return }
    if (url.pathname.startsWith('/bench/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(PNG); return }
    let file = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!existsSync(file)) file = join(DIST, 'index.html')
    try { res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file)) }
    catch { res.writeHead(500).end('no build') }
  })
  await new Promise<void>((r) => server.listen(5299, r))

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const save = {
      version: 3, points: 1000, totalEarned: 1000, xp: 0, clickCount: 0, critCount: 0,
      shards: 0, prestigeCount: 0, tags: [], gallery: [], caps: [], capsUsed: [],
      achievements: [], collectedOfflineEarnings: true, ageAccepted: true, defeated: 0,
      backgroundUrl: null, viewMode: 'single', setupComplete: true,
      userExcludes: [], lastSeenAt: Date.now(),
    }
    await page.addInitScript((s) => {
      localStorage.setItem('orbit_identity', JSON.stringify({
        orbitId: 'a'.repeat(64), publicKeyHex: 'aa'.repeat(32),
        privateKeyHex: 'bb'.repeat(32), createdAt: new Date().toISOString(),
      }))
      localStorage.setItem('goonMatch_age_verified', 'true')
      localStorage.setItem('orbit_display_name', 'E2E Tester')
      localStorage.setItem('gmatch.save.v1', JSON.stringify(s))
    }, save)

    const sample = () => page.evaluate(async () => {
      const d: number[] = []
      let last = performance.now()
      await new Promise<void>((res) => {
        let n = 0
        const tick = () => {
          const now = performance.now(); d.push(now - last); last = now
          if (++n >= 40) res(); else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      d.sort((a, b) => a - b)
      return { p50: Math.round(d[20]), p95: Math.round(d[38]) }
    })

    await page.goto('http://localhost:5299/#/feed')
    await page.waitForFunction(
      () => document.querySelectorAll('article[data-post-id^="bench-"]').length > 400,
      undefined, { timeout: 60000 })
    console.log('[bisect] baseline', JSON.stringify(await sample()))

    // Is it the IMAGES (300 x 1x1 png decode/paint)?
    await page.evaluate(() => document.querySelectorAll('article img').forEach((i) => i.remove()))
    console.log('[bisect] no <img>', JSON.stringify(await sample()))

    // Is it the ROW COUNT (React reconciliation of 500 subtrees)?
    await page.evaluate(() => document.querySelectorAll('article').forEach((e, i) => { if (i > 60) e.remove() }))
    console.log('[bisect] 60 rows', JSON.stringify(await sample()))
  } finally {
    await browser.close()
    await new Promise<void>((r) => server.close(() => r()))
  }
})