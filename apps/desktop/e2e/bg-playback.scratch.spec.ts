import { test, expect } from '@playwright/test'
import { seedApp } from './helpers'

// Scratch probe (T7): theater stays mounted + keeps playing when leaving the
// Watch tab; exactly one <video> per room (dock is a switcher, no 2nd player).
test.use({ permissions: [] })

test('bg playback survives tab switch, single player', async ({ page }) => {
  test.setTimeout(120_000)
  const console404: string[] = []
  page.on('console', (m) => { if (m.text().includes('404')) console404.push(m.location().url || m.text()) })
  await seedApp(page)
  await page.goto('http://localhost:5199/#/watch')
  await page.waitForSelector('text=/START A PARTY|Start a party|Watch/i', { timeout: 30_000 })

  // Seed a room server-side through the UI is heavy; go direct: create party
  // via the app's own fetch by calling the modal is flaky headless (needs a
  // real media parse). Instead inject a party via the store over the WS? No:
  // simplest honest path - create the room via HTTP with the SAME identity
  // the app seeded (orbit_identity is in localStorage; signing needs the
  // private key which IS in that record).
  const created = await page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem('orbit_identity') || '{}')
    const base = (window as any).__API_BASE__ || 'http://127.0.0.1:8790'
    const body = JSON.stringify({ url: 'https://www.w3schools.com/html/mov_bbb.mp4', name: 'E2E Room' })
    // orbitFetch signs via the app's own util when present on window; fall
    // back to a signed-less POST which the server rejects -> use the app
    // module through a dynamic import.
    const mod = await import('/src/utils/api.ts')
    const res = await (mod as any).orbitFetch('/api/watchparty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, id)
    return { status: res.status, json: res.ok ? await res.json() : null }
  })
  expect(created.status).toBe(201)
  const roomId = created.json.party.id

  await page.evaluate((rid) => { location.hash = `#/watch?room=${rid}` }, roomId)
  await page.waitForSelector('video', { timeout: 30_000 })
  // Start PARTY playback through the store (a manual play() gets re-paused
  // by the sync tick while the room frame says 'pause' - correct behavior).
  await page.evaluate(async (rid) => {
    const store = await import('/src/hooks/watchPartyStore.ts')
    const v = document.querySelector('video')
    store.controlPlayback(rid, 'play', v ? v.currentTime : 0)
  }, roomId)
  await page.waitForTimeout(2500)

  // Switch to the feed tab: the video element must SURVIVE (BG playback)
  await page.evaluate(() => { location.hash = '#/feed' })
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement | null
    return { exists: !!v, t: v ? v.currentTime : -1 }
  })
  expect(after.exists).toBe(true)
  // It kept advancing while off-tab (unmount would have reset/destroyed it)
  expect(after.t).toBeGreaterThan(1.5)
  // Exactly one player in the DOM for the room.
  const count = await page.evaluate(() => document.querySelectorAll('video').length)
  expect(count).toBe(1)
  console.log('BG-PROBE-404s:', JSON.stringify(console404))
})
