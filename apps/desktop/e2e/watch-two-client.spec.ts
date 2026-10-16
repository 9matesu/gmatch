import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

// Two INDEPENDENT clients (separate browser contexts = separate identities,
// storage, sockets, and <video> elements) against the same node. Unit tests
// prove the frame math; only this proves the room actually stays together.
//
// Coverage: host play/pause/seek propagate to the viewer, a late joiner lands
// on the live position, the queue is identical on both sides, chat crosses,
// and a reload recovers without corrupting the session.
test.setTimeout(240_000)

const ROOM_NAME = 'E2E Two Client Sync'

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
  clipError = 'no reachable sample video (the server must resolve a real media URL)'
})

function slotVideo(page: Page) {
  return page.locator('.watch-party-slot[data-active="true"] video')
}

async function videoState(page: Page): Promise<{ paused: boolean; time: number; duration: number }> {
  return page.evaluate(() => {
    const v = document.querySelector('.watch-party-slot[data-active="true"] video') as HTMLVideoElement | null
    if (!v) throw new Error('no active video element')
    return { paused: v.paused, time: v.currentTime, duration: v.duration }
  })
}

async function createRoom(page: Page) {
  await page.getByRole('button', { name: 'Create a new room' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Watch Party' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByLabel('Video URL').fill(clip)
  await dialog.getByLabel('Party name').fill(ROOM_NAME)
  await dialog.getByRole('button', { name: 'START PARTY', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Leave room' })).toBeVisible({ timeout: 60_000 })
}

async function joinRoom(page: Page) {
  await page.getByRole('button', { name: `Join room ${ROOM_NAME}` }).click()
  await expect(page.getByRole('button', { name: 'Leave room' })).toBeVisible({ timeout: 60_000 })
  // Same join-race guard as the persistence spec: the Leave button renders
  // from the local snapshot, but only server-side membership makes our
  // frames (chat, ready) count.
  await expect(page.locator('aside', { hasText: 'In this room' }).getByText('you', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

async function say(page: Page, text: string) {
  const composer = page.getByPlaceholder('Message').first()
  await expect(composer).toBeVisible({ timeout: 20_000 })
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 })
}

test('play, pause, seek, queue, chat and reload stay consistent across two clients', async ({ browser }: { browser: Browser }) => {
  test.skip(!clip, clipError)

  // Two fully independent clients: separate storage, identity, socket.
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const host = await ctxA.newPage()
  const viewer = await ctxB.newPage()
  try {
    await seedApp(host)
    await seedApp(viewer)
    // The browse list fetches once on mount, so the host creates first and
    // the viewer navigates after: otherwise the viewer waits on a card that
    // its already-loaded list will never show.
    await host.goto('/#/watch')
    await createRoom(host)
    await viewer.goto('/#/watch')
    await joinRoom(viewer)

    // Both sides render the player for the same entry.
    await expect(slotVideo(host)).toBeVisible({ timeout: 30_000 })
    await expect(slotVideo(viewer)).toBeVisible({ timeout: 30_000 })

    // PLAY propagates: the viewer leaves paused state. (The transport button,
    // not the slot's center overlay, which shares its accessible name.)
    await host.getByTestId('watch-transport-play').click()
    await expect
      .poll(async () => (await videoState(viewer)).paused, { timeout: 30_000 })
      .toBe(false)

    // SEEK propagates: scrub the host to the middle, the viewer follows.
    const scrub = host.getByRole('slider', { name: 'Seek video position' })
    const box = await scrub.boundingBox()
    expect(box).toBeTruthy()
    await host.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height / 2)
    await expect
      .poll(
        async () => {
          const s = await videoState(viewer)
          return s.duration > 0 ? s.time / s.duration : -1
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0.35)

    // PAUSE propagates.
    await host.getByTestId('watch-transport-play').click()
    await expect
      .poll(async () => (await videoState(viewer)).paused, { timeout: 30_000 })
      .toBe(true)

    // QUEUE is identical: host queues a second clip, both sides count two.
    await host.getByRole('button', { name: 'Add to queue' }).click()
    await host.getByLabel('Queue video URLs').fill(CLIP_CANDIDATES[1])
    await host.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(host.getByText('Queue (2)')).toBeVisible({ timeout: 30_000 })
    await expect(viewer.getByText('Queue (2)')).toBeVisible({ timeout: 30_000 })

    // CHAT crosses the room.
    await say(viewer, 'two-client hello')
    await expect(host.getByText('two-client hello').first()).toBeVisible({ timeout: 20_000 })

    // RELOAD recovers: the viewer rejoins from its remembered room and the
    // session (paused frame + queue + chat) is intact, not corrupted.
    await viewer.reload()
    await expect(viewer.getByRole('button', { name: 'Leave room' })).toBeVisible({ timeout: 60_000 })
    await expect(viewer.locator('aside', { hasText: 'In this room' }).getByText('you', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await expect(viewer.getByText('Queue (2)')).toBeVisible({ timeout: 30_000 })
    await expect(viewer.getByText('two-client hello').first()).toBeVisible({ timeout: 20_000 })
    expect((await videoState(viewer)).paused).toBe(true)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
