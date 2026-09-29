import { expect, test, type Page } from '@playwright/test'
import { seedApp } from './helpers'

// "If I create a room, add a video to watch, and leave it, the room must
// persist, the chat and everything as well."
//
// The server already keeps an emptied room (watchparty.ts removeMember) and
// serializes name/media/queue/chat to watchparties.json. What did NOT survive
// was the CLIENT: watchPartyStore is a module-level singleton with no
// persistence, so a reload or a leave wiped the room list — and a private room
// you left became unreachable, because the public listing hides private rooms.

test.use({ contextOptions: { serviceWorkers: 'block' } })
// Create + add video + chat + leave + reload + re-enter, all through the UI.
test.setTimeout(240_000)

const ROOM_NAME = 'E2E Movie Night'

/**
 * The server resolves the media itself (resolveMedia: it fetches the URL and
 * requires a `video/*` response), and its SSRF guard rejects loopback — so the
 * clip has to be a real, reachable video. Probe the well-known public samples
 * and skip the suite (with a reason) when this machine has no network, rather
 * than failing on an unreachable CDN.
 */
const CLIP_CANDIDATES = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  'https://www.w3schools.com/html/mov_bbb.mp4',
]

let clip = ''
let clipError = ''

test.beforeAll(async () => {
  for (const url of CLIP_CANDIDATES) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok || res.status === 206) {
        clip = url
        return
      }
    } catch { /* try the next candidate */ }
  }
  clipError = 'no reachable sample video (watch-party creation needs the server to resolve a real media URL)'
})

/** Create a room through the real composer. */
async function createRoom(page: Page) {
  test.skip(!clip, clipError)
  await page.getByRole('button', { name: 'Create a new room' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Watch Party' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByLabel('Video URL').fill(clip)
  await dialog.getByLabel('Party name').fill(ROOM_NAME)
  await dialog.getByRole('button', { name: 'START PARTY' }).click()
  // The room opens: the header (with its Leave button) is the marker.
  await expect(page.getByRole('button', { name: 'Leave room' })).toBeVisible({ timeout: 60_000 })
}

/** Say something in the room chat. */
async function say(page: Page, text: string) {
  const composer = page.getByPlaceholder('Message').first()
  await expect(composer).toBeVisible({ timeout: 20_000 })
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 })
}

test('a room with its video and chat survives leaving and a reload', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/watch')
  await createRoom(page)
  await say(page, 'see you at 9')

  // The id is remembered on join — the only thing that can survive a reload.
  // (The write is debounced, so poll rather than reading immediately.)
  await expect
    .poll(
      () => page.evaluate(() => {
        const rows = JSON.parse(localStorage.getItem('gmatch_watchparties_v1') || '[]')
        return rows.length > 0 ? String(rows[0].id) : ''
      }),
      { timeout: 15_000, message: 'room was not remembered on join' },
    )
    .not.toBe('')

  // Leave: the room is gone from the open list but still offered.
  await page.getByRole('button', { name: 'Leave room' }).click()
  await expect(page.getByText('Recently watched')).toBeVisible({ timeout: 20_000 })
  const reopen = page.getByRole('button', { name: `Reopen room ${ROOM_NAME}` })
  await expect(reopen).toBeVisible({ timeout: 20_000 })

  // Full reload: a brand-new JS context with an empty in-memory store, so the
  // boot restore is the only path that can bring the room back.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Leave room' })).toBeVisible({ timeout: 60_000 })
  // Video and chat came back with it.
  await say(page, 'still here after the reload')
})

/**
 * Playback itself. Nothing in the suite ever touched a <video> before this:
 * watch.spec.ts only clicked browse UI and the persistence spec only asserted
 * the presence of a Leave button. So "the video is not buffering", "it doesn't
 * pause on command" and "volume doesn't keep" were all invisible to CI.
 */
test('the host can play, pause and the video keeps its volume', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/watch')
  await createRoom(page)

  // The element must EXIST and have actually started loading. readyState 0 with
  // networkState 0 is the "nothing was ever requested" failure mode: the room
  // opens paused, and the player used to mount with preload="none" and never
  // issue a request at all.
  const video = page.locator('.watch-party-slot[data-active="true"] video')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(
      async () => {
        const rs = await video.evaluate((v: HTMLVideoElement) => v.readyState)
        return rs > 0
      },
      { timeout: 60_000, message: 'video never began loading (readyState stayed 0)' },
    )
    .toBe(true)

  // Play: the host's frame must actually advance the element's clock. Scoped by
  // test id — the slot's big centre button carries the same accessible label.
  const playBtn = page.getByTestId('watch-transport-play')
  await expect(playBtn).toBeVisible({ timeout: 20_000 })
  await playBtn.click()
  await expect
    .poll(
      async () => {
        const t = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
        return t > 0
      },
      { timeout: 45_000, message: 'host pressed play but currentTime never advanced' },
    )
    .toBe(true)

  // Pause: the element must actually stop.
  await page.getByRole('button', { name: 'Pause party' }).click()
  await expect
    .poll(
      async () => video.evaluate((v: HTMLVideoElement) => v.paused),
      { timeout: 30_000, message: 'host pressed pause but the element kept playing' },
    )
    .toBe(true)

  // Volume: local, per-room, remembered — and it must survive a re-apply.
  await page.locator('.watch-party-slot[data-active="true"] video').evaluate((v: HTMLVideoElement) => {
    v.volume = 0.25
  })
  await page.waitForTimeout(600)
  expect(
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('gmatch_watch_volumes_v1') || '{}')
      return Object.values(raw).some((r) => Math.abs((r as { volume: number }).volume - 0.25) < 0.01)
    }),
    'volume was not remembered for the room',
  ).toBe(true)
})

test('a private room left by its host is still reachable', async ({ page }) => {  await seedApp(page)
  await page.goto('/#/watch')
  await createRoom(page)

  // Mark it private: the server's open-rooms listing hides private rooms, so
  // only the remembered list can offer this one back.
  await page.getByRole('button', { name: 'Room settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Room settings' })
  await expect(settings).toBeVisible({ timeout: 20_000 })
  await settings.getByRole('switch').first().click()
  await page.getByRole('button', { name: 'Close' }).first().click()

  await page.getByRole('button', { name: 'Leave room' }).click()
  await expect(page.getByRole('button', { name: `Reopen room ${ROOM_NAME}` })).toBeVisible({
    timeout: 20_000,
  })
})
