// CDP perf probe (chrome-devtools-mcp methodology, driven locally — the cloud
// browser cannot reach loopback). Seeds the app like e2e/helpers, clicks
// through the real routes, and prints Performance.getMetrics deltas, heap,
// console errors and long tasks. Rerun verbatim for before/after comparison.
//
// usage: node tools/perf-cdp.mjs [baseUrl]  > perf-baseline.json (stdout JSON)
import { chromium } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { readFileSync } from 'fs'

const BASE = process.argv[2] || 'http://127.0.0.1:5174/'
const legalKey = readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim()

const identity = generateIdentity()
const save = {
  version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000,
  xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0,
  tags: [{ name: 'gangbang', level: 1, selected: true, base: 10, income: 0, weight: 1 }],
  gallery: [], caps: [], capsUsed: [], achievements: [],
  collectedOfflineEarnings: true, ageAccepted: true, defeated: 0,
  backgroundUrl: null, viewMode: 'single', setupComplete: true,
  userExcludes: [], lastSeenAt: Date.now(),
}

const LEAN = process.env.LEAN === '1' // emulate prefers-reduced-motion (probe A/B for the sheen cost)
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: LEAN ? 'reduce' : 'no-preference' })
const cdp = await page.context().newCDPSession(page)

const consoleErrors = []
const warnings = []
const failedRequests = []
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url().slice(0, 140)) })
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
  if (m.type() === 'warning') warnings.push(m.text().slice(0, 160))
})
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 300)))

await cdp.send('Performance.enable')

// Deterministic feed: the sidecar's /api/booru/* proxies answer with synthetic
// 1x1 tiles so timings don't depend on external mirror health (same trick as
// e2e/helpers mockBooruFeed).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
await page.route('**/__perf__/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }))
let bn = 0
await page.route('**/api/booru/**', async (route) => {
  const images = Array.from({ length: 20 }, (_, i) => ({
    url: 'http://localhost:5173/__perf__/' + bn + '_' + i + '.png',
    caption: 'e2e foe',
  }))
  bn++
  await route.fulfill({ json: { images } })
})

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const heap = async () => (await cdp.send('Runtime.getHeapUsage')).usedSize

// FPS sample helper via rAF counting
const fps = async (ms = 3000) => page.evaluate((d) => new Promise((res) => {
  let n = 0; const t0 = performance.now()
  const tick = () => { n++; if (performance.now() - t0 < d) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))) }
  requestAnimationFrame(tick)
}), ms)

await cdp.send('Tracing.start', {
  categories: 'devtools.perf,devtools.timeline,disabled-by-default-devtools.timeline',
  transferMode: 'ReportEvents',
})
const traceEvents = []
cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value))
const traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r))

// Real CPU profile (DevTools "Performance" panel engine) for JS attribution.
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.enable')
const profileChunks = []
cdp.on('Profiler.chunk', ({ profile }) => profileChunks.push(profile))
cdp.on('Profiler.reset', () => profileChunks.length = 0)
await cdp.send('Profiler.start')

const m0 = await metrics()
const steps = []
const t = async (label, fn) => { const s = Date.now(); await fn(); steps.push({ label, ms: Date.now() - s }) }

await t('load', async () => {
  await page.addInitScript(([id, sv, lk, oid]) => {
    localStorage.setItem('orbit_identity', JSON.stringify(id))
    localStorage.setItem('goonMatch_age_verified', 'true')
    localStorage.setItem('orbit_legal_accepted', lk)
    localStorage.setItem('orbit_display_name', 'E2E Tester')
    localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
    localStorage.setItem(`gmatch.save.v1:${oid}`, JSON.stringify(sv))
    localStorage.setItem('gmatch.save.v1', JSON.stringify(sv))
    localStorage.setItem(`orbit_onboarding_v2:${oid}`, JSON.stringify({ version: 1, current: 'ready', completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'] }))
  }, [identity, save, legalKey, identity.orbitId])
  await page.goto(BASE, { waitUntil: 'networkidle' })
})
await t('home-idle-3s', () => page.waitForTimeout(3000))
await t('click-feed-tabs', async () => {
  for (const r of ['#/games', '#/servers', '#/gallery', '#/store', '#/grid']) {
    await page.evaluate((h) => { window.location.hash = h }, r)
    await page.waitForTimeout(900)
  }
})
await t('idle-clicks-20', async () => {
  await page.evaluate(() => { window.location.hash = '#/grid' })
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await stage.waitFor({ timeout: 25_000 })
  for (let i = 0; i < 20; i++) {
    await stage.click({ timeout: 4000 })
    await page.waitForTimeout(35)
  }
})
await t('sidebar-collapse-cycle', async () => {
  const btn = page.locator('[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]').first()
  const w0 = await page.locator('aside.desktop-sidebar').evaluate((el) => el.getBoundingClientRect().width)
  await btn.click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(500)
  const w1 = await page.locator('aside.desktop-sidebar').evaluate((el) => el.getBoundingClientRect().width)
  const btn2 = page.locator('[aria-label="Expand sidebar"], [aria-label="Collapse sidebar"]').first()
  const clickable = await btn2.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return !!(hit && (hit === el || el.contains(hit)))
  }).catch(() => false)
  await btn2.click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(500)
  const w2 = await page.locator('aside.desktop-sidebar').evaluate((el) => el.getBoundingClientRect().width)
  steps.push({ label: 'SIDEBAR', widths: [w0, w1, w2], expandClickableWhenCollapsed: clickable })
})
await t('scroll-feed', async () => {
  await page.evaluate(() => { window.location.hash = '#/' })
  await page.waitForTimeout(800)
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(160) }
})
const fpsNow = await fps(3000)
const m1 = await metrics()
const heapNow = await heap()
const prof = (await cdp.send('Profiler.stop')).profile
await cdp.send('Tracing.end')
await traceDone

// top self-time functions from the CPU profile
const { nodes, timeDeltas, samples } = prof
const nodeById = new Map(nodes.map((x) => [x.id, x]))
const selfMs = new Map()
for (let i = 0; i < samples.length; i++) {
  const dt = (timeDeltas[i] || 0) / 1000
  const n = nodeById.get(samples[i])
  const cf = n?.callFrame || {}
  const key = (cf.functionName || '(anon)') + ' @' + String(cf.url || '').replace(/^http[^/]+/, '').slice(-55) + ':' + (cf.lineNumber ?? '')
  selfMs.set(key, (selfMs.get(key) || 0) + dt)
}
const topSelf = [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  .map(([k, ms]) => ({ ms: Math.round(ms), where: k }))

// long tasks >50ms from trace (RunTask top-level durations approximated by EventDispatch+FunctionCall heavy)
const longish = traceEvents.filter((e) => e.ph === 'X' && e.dur > 50000 && ['FunctionCall', 'EvaluateScript', 'Layout', 'UpdateLayoutTree', 'MajorGC', 'MinorGC', 'Paint'].includes(e.name))
const byName = {}
for (const e of longish) byName[e.name] = (byName[e.name] || 0) + 1
// who exactly? top long FunctionCall sites with their frame URL
const calls = traceEvents
  .filter((e) => e.ph === 'X' && e.name === 'FunctionCall' && e.dur > 60000)
  .map((e) => ({
    ms: Math.round(e.dur / 1000),
    fn: e.args?.data?.functionName ?? '',
    url: String(e.args?.data?.url ?? '').replace(/^http[^/]+/, '').slice(0, 90),
  }))
  .sort((a, b2) => b2.ms - a.ms)
  .slice(0, 12)
// layer/composited count proxy: elements with backdrop-filter
const glassCount = await page.evaluate(() => {
  let n = 0
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el)
    if (s.backdropFilter && s.backdropFilter !== 'none') n++
  }
  return n
})

const delta = (k) => +((m1[k] ?? 0) - (m0[k] ?? 0)).toFixed(3)
console.log(JSON.stringify({
  base: BASE,
  lean: LEAN, steps,
  metricsDeltaSec: { TaskDuration: delta('TaskDuration'), LayoutDuration: delta('LayoutDuration'), RecalcStyleDuration: delta('RecalcStyleDuration'), ScriptDuration: delta('ScriptDuration'), StyleAndLayoutDuration: delta('StyleAndLayoutDuration') },
  heapUsedMB: +(heapNow / 1048576).toFixed(1),
  fpsScrollSample: fpsNow,
  glassBackdropElements: glassCount,
  longOpsOver50ms: byName,
  topLongCalls: calls,
  topSelfTimeMs: topSelf,
  consoleErrors: consoleErrors.slice(0, 25),
  consoleErrorsCount: consoleErrors.length,
  failedRequests: [...new Set(failedRequests)].slice(0, 15),
  warningsCount: warnings.length,
  domNodes: await page.evaluate(() => document.getElementsByTagName('*').length),
}, null, 1))
await browser.close()