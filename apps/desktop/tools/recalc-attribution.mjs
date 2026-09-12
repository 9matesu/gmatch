import { chromium } from '@playwright/test'
// Which animation class owns the 2.6s RecalcStyle? Inject disable-CSS per group.
import { readFileSync } from 'fs'
const legalKey = readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim()
const { generateIdentity } = await import('../src/identity.cjs')
const id = generateIdentity()
const save = { version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000, xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0, tags: [], gallery: [], caps: [], capsUsed: [], achievements: [], collectedOfflineEarnings: true, ageAccepted: true, defeated: 0, backgroundUrl: null, viewMode: 'single', setupComplete: true, userExcludes: [], lastSeenAt: Date.now() }

const GROUPS = {
  none: '',
  infiniteAll: '*,*::before,*::after{animation-iteration-count:1 !important}',
  transitions: '*{transition:none !important}',
  sheenOnly: '.chrome-accent,.text-chrome,.chrome-border::before,.accent-control,.create-action,.metallic-card-border{animation:none !important}',
  pulseFlux: '.animate-orbit-pulse-soft,.animate-orbit-card-flux{animation:none !important}',
  grain: '.grain-overlay,.grain-overlay::after{display:none !important}',
  grainNoBlend: '.grain-overlay::after{mix-blend-mode:normal !important}',
}
const browser = await chromium.launch({ channel: 'chrome' })
for (const [name, css] of Object.entries(GROUPS)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.addInitScript(([i, sv, lk, cssx]) => {
    localStorage.setItem('orbit_identity', JSON.stringify(i))
    localStorage.setItem('goonMatch_age_verified', 'true')
    localStorage.setItem('orbit_legal_accepted', lk)
    localStorage.setItem('orbit_display_name', 'E2E Tester')
    localStorage.setItem(`gmatch.save.v1:${i.orbitId}`, JSON.stringify(sv))
    localStorage.setItem('gmatch.save.v1', JSON.stringify(sv))
    localStorage.setItem(`orbit_onboarding_v2:${i.orbitId}`, JSON.stringify({ version: 1, current: 'ready', completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'] }))
    if (cssx) {
      addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = cssx; document.head.appendChild(s) })
    }
  }, [id, save, legalKey, css])
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  await page.waitForTimeout(4000)
  // walk a bit
  await page.evaluate(() => { window.location.hash = '#/grid' })
  await page.waitForTimeout(2500)
  await page.evaluate(() => { window.location.hash = '#/' })
  await page.waitForTimeout(2500)
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  console.log(name.padEnd(12), 'recalc', (m1.RecalcStyleDuration - m0.RecalcStyleDuration).toFixed(2), 'task', (m1.TaskDuration - m0.TaskDuration).toFixed(2))
  await page.close()
}
await browser.close()