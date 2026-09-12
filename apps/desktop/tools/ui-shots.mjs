import { chromium } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { readFileSync } from 'fs'

const legalKey = readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim()
const id = generateIdentity()
const save = { version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000, xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0, tags: [{ name: 'gangbang', level: 1, selected: true, base: 10, income: 0, weight: 1 }], gallery: [], caps: [], capsUsed: [], achievements: [], collectedOfflineEarnings: true, ageAccepted: true, defeated: 0, backgroundUrl: null, viewMode: 'single', setupComplete: true, userExcludes: [], lastSeenAt: Date.now() }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
let bn = 0
await page.route('**/__shot__/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }))
await page.route('**/api/booru/**', async (route) => {
  const images = Array.from({ length: 20 }, (_, i) => ({ url: 'http://localhost:4173/__shot__/' + bn + '_' + i + '.png', caption: 'e2e foe' }))
  bn++
  await route.fulfill({ json: { images } })
})
await page.addInitScript(([i, sv, lk]) => {
  localStorage.setItem('orbit_identity', JSON.stringify(i))
  localStorage.setItem('goonMatch_age_verified', 'true')
  localStorage.setItem('orbit_legal_accepted', lk)
  localStorage.setItem('orbit_display_name', 'E2E Tester')
  localStorage.setItem(`gmatch.save.v1:${i.orbitId}`, JSON.stringify(sv))
  localStorage.setItem('gmatch.save.v1', JSON.stringify(sv))
  localStorage.setItem(`orbit_onboarding_v2:${i.orbitId}`, JSON.stringify({ version: 1, current: 'ready', completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'] }))
}, [id, save, legalKey])
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

await page.screenshot({ path: 'I:/goongrid/.shots/home.png' })
// collapse sidebar -> rail screenshot
await page.locator('[aria-label="Collapse sidebar"]').first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: 'I:/goongrid/.shots/rail.png' })
await page.locator('[aria-label="Expand sidebar"]').first().click()
await page.waitForTimeout(400)
// servers view
await page.evaluate(() => { window.location.hash = '#/servers' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'I:/goongrid/.shots/servers.png' })
// idle stage
await page.evaluate(() => { window.location.hash = '#/grid' })
await page.waitForTimeout(1800)
await page.screenshot({ path: 'I:/goongrid/.shots/idle.png' })
await browser.close()
console.log('captured 4 shots')