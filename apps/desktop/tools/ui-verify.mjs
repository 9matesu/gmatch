import { chromium } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { readFileSync } from 'fs'
const legalKey = readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim()
const id = generateIdentity()
const save = { version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000, xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0, tags: [{ name: 'x', level: 1, selected: true, base: 10, income: 0, weight: 1 }], gallery: [], caps: [], capsUsed: [], achievements: [], collectedOfflineEarnings: true, ageAccepted: true, defeated: 0, backgroundUrl: null, viewMode: 'single', setupComplete: true, userExcludes: [], lastSeenAt: Date.now() }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
let bn = 0
await page.route('**/__shot__/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }))
await page.route('**/api/booru/**', async (route) => {
  await route.fulfill({ json: { images: Array.from({ length: 20 }, (_, i) => ({ url: 'http://localhost:4173/__shot__/' + bn + '_' + i + '.png', caption: 'e2e foe' })) } })
  bn++
})
await page.addInitScript(([i, sv, lk]) => {
  localStorage.setItem('orbit_identity', JSON.stringify(i))
  localStorage.setItem('goonMatch_age_verified', 'true')
  localStorage.setItem('orbit_legal_accepted', lk)
  localStorage.setItem('orbit_display_name', 'E2E Tester')
  localStorage.setItem(`gmatch.save.v1:${i.orbitId}`, JSON.stringify(sv))
  localStorage.setItem('gmatch.save.v1', JSON.stringify(sv))
  localStorage.setItem(`orbit_onboarding_v2:${i.orbitId}`, JSON.stringify({ version: 1, current: 'ready', completed: ['welcome','auth','profile','platform','feed','tune','cards','economy','games','ready'] }))
}, [id, save, legalKey])
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1) arrow geometry on stage
await page.evaluate(() => { window.location.hash = '#/grid' })
await page.waitForTimeout(1800)
const arrows = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[aria-label="Previous image"], [aria-label="Next image"]')]
  return els.map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { label: el.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), cls: el.className.slice(0, 40), border: cs.borderTopWidth } })
})
console.log('arrows', JSON.stringify(arrows))

// 2) settings rows exist (open settings via gear)
const gear = page.locator('[aria-label="Settings"], button:has-text("Settings")').last()
await gear.click().catch(() => {})
await page.waitForTimeout(900)
const s1 = await page.locator('#glass-blur').count()
const val0 = s1 ? await page.locator('#glass-blur').inputValue() : 'n/a'
console.log('glass slider present:', s1, 'value', val0)
const motion = await page.locator('[role="dialog"] [role="switch"]').count()
// toggle animated chrome: find the row by text
const hasRow = await page.getByText('Animated chrome').count()
console.log('animated chrome row:', hasRow, 'switches in modal:', motion)
// drag glass slider to 0 and check the CSS var reacts live
if (s1) {
  await page.locator('#glass-blur').fill('0')
  await page.waitForTimeout(300)
  const varNow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-blur'))
  console.log('after slider 0 -> --glass-blur =', JSON.stringify(varNow))
}
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 3) sidebar collapse -> expand still works (already covered by e2e but check here too)
console.log('data-motion attr (should be absent default):', JSON.stringify(await page.evaluate(() => document.documentElement.getAttribute('data-motion'))))
await browser.close()
console.log('done')