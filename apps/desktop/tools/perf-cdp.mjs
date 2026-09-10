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

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const cdp = await page.context().newCDPSession(page)

const consoleErrors = []
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
  if (m.type() === 'warning') warnings.push(m.text().slice(0, 160))
})
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 300)))

await cdp.send('Performance.enable')

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
  for (const name of ['Games', 'Servers', 'Gallery', 'Store', 'Idle']) {
    await page.locator(`aside button:has-text("${name}")`).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(700)
  }
})
await t('idle-clicks-20', async () => {
  await page.locator('aside button:has-text("Idle")').first().click().catch(() => {})
  await page.waitForTimeout(600)
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(600, 500)
    await page.waitForTimeout(40)
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
  await page.locator('aside button:has-text("Home"), aside button[aria-label="Home"]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(160) }
})
const fpsNow = await fps(3000)
const m1 = await metrics()
const heapNow = await heap()
await cdp.send('Tracing.end')
await traceDone

// long tasks >50ms from trace (RunTask top-level durations approximated by EventDispatch+FunctionCall heavy)
const longish = traceEvents.filter((e) => e.ph === 'X' && e.dur > 50000 && ['FunctionCall', 'EvaluateScript', 'Layout', 'UpdateLayoutTree', 'MajorGC', 'MinorGC', 'Paint'].includes(e.name))
const byName = {}
for (const e of longish) byName[e.name] = (byName[e.name] || 0) + 1
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
  base: BASE, steps,
  metricsDeltaSec: { TaskDuration: delta('TaskDuration'), LayoutDuration: delta('LayoutDuration'), RecalcStyleDuration: delta('RecalcStyleDuration'), ScriptDuration: delta('ScriptDuration'), StyleAndLayoutDuration: delta('StyleAndLayoutDuration') },
  heapUsedMB: +(heapNow / 1048576).toFixed(1),
  fpsScrollSample: fpsNow,
  glassBackdropElements: glassCount,
  longOpsOver50ms: byName,
  consoleErrors: consoleErrors.slice(0, 25),
  consoleErrorsCount: consoleErrors.length,
  warningsCount: warnings.length,
  domNodes: await page.evaluate(() => document.getElementsByTagName('*').length),
}, null, 1))
await browser.close()