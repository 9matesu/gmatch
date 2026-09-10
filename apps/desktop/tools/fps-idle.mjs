import { chromium } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { readFileSync } from 'fs'

const BASE = process.env.BASE || 'http://localhost:5173/'
const SEED = process.argv[2] || 'idle'
const legalKey = readFileSync('I:/goongrid/.legal-key.txt', 'utf8').trim()
const id = generateIdentity()
const save = {
  version: 3, gc: 50000, credited: 0, debited: 0, totalEarnedGc: 50000,
  xp: 0, clickCount: 0, critCount: 0, shards: 0, prestigeCount: 0,
  tags: [{ name: 'gangbang', level: 1, selected: true, base: 10, income: 0, weight: 1 }],
  gallery: [], caps: [], capsUsed: [], achievements: [],
  collectedOfflineEarnings: true, ageAccepted: true, defeated: 0,
  backgroundUrl: null, viewMode: 'single', setupComplete: true,
  userExcludes: [], lastSeenAt: Date.now(),
}
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(([pid, pk, pn, saved, key, sk]) => {
  localStorage.setItem('gmatch:device:public-key', pid)
  localStorage.setItem('gmatch:device:private-key', pk)
  localStorage.setItem('gmatch:device:name', pn)
  localStorage.setItem('gmatch:legal-ack:key', key)
  localStorage.setItem(sk, saved)
}, [id.publicKey, id.privateKey, id.name, legalKey, `gmatch:save:${id.publicKey}`, JSON.stringify(save)])
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(6000)
if (SEED === 'game') {
  // click the primary CTA into the play surface if any
  try {
    const b = page.locator('button').filter({ hasText: /play|goon|start|enter|jogar|assistir/i }).first()
    if (await b.count()) await b.click({ timeout: 2000 })
  } catch {}
  await page.waitForTimeout(4000)
}
const res = await page.evaluate(async () => {
  const t0 = performance.now()
  let frames = 0, longTasks = 0, longest = 0
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { longTasks++; longest = Math.max(longest, e.duration) } }).observe({ entryTypes: ['longtask'] })
  await new Promise((done) => {
    const tick = () => { frames++; performance.now() - t0 < 6000 ? requestAnimationFrame(tick) : done() }
    requestAnimationFrame(tick)
  })
  const anims = document.getAnimations().filter((a) => a.playState === 'running').length
  return { fps: Math.round((frames * 1000) / (performance.now() - t0)), longTasks, longest: Math.round(longest), runningAnimations: anims }
})
console.log(JSON.stringify({ state: SEED, base: BASE, ...res }))
await browser.close()
