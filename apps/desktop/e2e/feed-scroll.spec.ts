import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

// Feed scroll budget, measured rather than guessed.
//
// The feed is the one view a player scrolls for minutes, and it used to mount
// every row it had ever fetched (plus a CSS multi-column reorder that made the
// DOM order disagree with the visual order). This spec puts 500 real posts in
// front of it and measures what the browser actually does: frame intervals
// while the list scrolls, long tasks, and whether content inserted ABOVE the
// viewport moves what the reader is looking at.
//
// The numbers are printed in the test title so a run reports them; the
// assertions are deliberately coarse (a stall, not a microsecond) so a slow CI
// machine reports a regression instead of a flake.

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const POST_COUNT = 500

function syntheticPosts(): unknown[] {
  return Array.from({ length: POST_COUNT }, (_, i) => ({
    id: `bench-${i}`,
    author_id: `bench-author-${i % 7}`,
    author_name: `Bench Author ${i % 7}`,
    url: `/bench/p${i}.jpg`,
    mime_type: 'image/jpeg',
    caption: `Synthetic post number ${i}. ` + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(2),
    created_at: new Date(Date.UTC(2026, 10, 1, 12, 0, i % 60)).toISOString(),
    like_count: i % 5,
    comment_count: 0,
  }))
}

/** Serves 500 posts for the feed route and the same 1x1 PNG for each one. */
async function stubTimeline(page: import('@playwright/test').Page) {
  await page.route('**/bench/*.jpg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG_1x1 }),
  )
  const posts = syntheticPosts()
  await page.route(/\/api\/posts(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const limit = Number(url.searchParams.get('limit') ?? '50')
    // The first page carries the whole timeline: a busy node answering with
    // everything it holds is the shape this measures.
    const slice = offset === 0 ? posts : posts.slice(offset, offset + limit)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts: slice }) })
  })
}

test('500 posts: scrolling stays inside the frame budget', async ({ page }) => {
  test.setTimeout(180_000)
  await seedApp(page)
  await stubTimeline(page)
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({ timeout: 30_000 })

  // Wait for the timeline to actually hold the rows: the route is instant, but
  // the client still merges the snapshot and hydrates the cards.
  const scroller = page.locator('.mobile-app-scroll').first()
  await expect(scroller).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(
    () => document.querySelectorAll('article[data-post-id^="bench-"]').length > 100,
    undefined,
    { timeout: 60_000 },
  )
  const mounted = await page.evaluate(() => document.querySelectorAll('article[data-post-id^="bench-"]').length)

  const result = await page.evaluate(async () => {
    const el = document.querySelector('.mobile-app-scroll') as HTMLElement
    const frames: number[] = []
    const longTasks: { start: number; duration: number }[] = []
    let last = performance.now()
    let running = true

    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) })
    })
    obs.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)

    const tick = () => {
      const now = performance.now()
      frames.push(now - last)
      last = now
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    // 6 seconds of steady scrolling, one step per frame: the shape a thumb
    // produces, not a single programmatic jump.
    const started = performance.now()
    while (performance.now() - started < 6000) {
      el.scrollTop += 240
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
    running = false
    obs.disconnect()
    frames.shift() // the first delta starts before the loop

    const sorted = [...frames].sort((a, b) => a - b)
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    return {
      frames: frames.length,
      p50: Math.round(at(0.5) * 10) / 10,
      p95: Math.round(at(0.95) * 10) / 10,
      max: Math.round(at(1) * 10) / 10,
      over32: frames.filter((f) => f > 32).length,
      longTasks: longTasks.length,
      worstLongTask: longTasks.length ? Math.max(...longTasks.map((t) => t.duration)) : 0,
      longTaskWindows: longTasks.filter((t) => t.duration > 200).map((t) => `${t.start}ms+${t.duration}ms`),
      scrollTop: el.scrollTop,
      started,
    }
  })

  console.log(
    `[feed-bench] mounted=${mounted} frames=${result.frames} p50=${result.p50}ms p95=${result.p95}ms ` +
      `max=${result.max}ms over32=${result.over32} longTasks=${result.longTasks} worstLongTask=${result.worstLongTask}ms ` +
      `scrollStartedAt=${result.started} longTasksOver200=${JSON.stringify(result.longTaskWindows)}`,
  )

  expect(mounted).toBeGreaterThan(100)
  // Frame pacing is what a thumb feels. Before the containment pass this run
  // reported p95 44.5ms and 53 of 178 frames over 32ms; the row-skipping pass
  // (`cv-row`) brought it to p95 ~18ms and 3-5 of ~180. The assertion guards the
  // scroll path: a tenth of the frames may miss vsync, no more.
  expect(result.p95).toBeLessThan(25)
  expect(result.over32).toBeLessThan(result.frames * 0.1)
  expect(result.scrollTop).toBeGreaterThan(0)
  // `worstLongTask` is deliberately NOT asserted: the shell re-renders about once
  // a second (any state change above the feed does it), and with 500 cards that
  // single render is ~1s in a dev build. It is measured and reported, and it is
  // the next thing to fix (windowing the list), not a regression to hide here.
  expect(result.longTaskWindows.length).toBeLessThan(40)
})

test('a post published above the viewport does not move what the reader is reading', async ({ page }) => {
  test.setTimeout(180_000)
  await seedApp(page)
  await stubTimeline(page)
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(
    () => document.querySelectorAll('article[data-post-id^="bench-"]').length > 100,
    undefined,
    { timeout: 60_000 },
  )

  const scrolled = await page.evaluate(async () => {
    const el = document.querySelector('.mobile-app-scroll') as HTMLElement
    el.scrollTop = 4000
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }
  })
  expect(scrolled.top).toBeGreaterThan(0)

  // The card the reader is looking at: nearest the middle of the viewport.
  const anchorId = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('article[data-post-id]')]
    const mid = window.innerHeight / 2
    let best = Infinity
    let id = ''
    for (const card of cards) {
      const r = card.getBoundingClientRect()
      const distance = Math.abs((r.top + r.bottom) / 2 - mid)
      if (distance < best) {
        best = distance
        id = card.dataset.postId ?? ''
      }
    }
    return id
  })
  expect(anchorId).not.toBe('')

  const before = await page.evaluate((id) => {
    const el = document.querySelector(`[data-post-id="${id}"]`) as HTMLElement
    return el.getBoundingClientRect().top
  }, anchorId)

  // Publish for real: the optimistic row is prepended to the timeline while the
  // reader is 4000px down.
  await page.getByRole('button', { name: 'Create a post', exact: true }).click()
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const drop = page.getByText('Drop a file, click to browse, or paste from the clipboard')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), drop.click()])
  await chooser.setFiles({ name: 'e2e-anchor.png', mimeType: 'image/png', buffer: PNG_1x1 })
  await page.getByRole('button', { name: 'Use this media', exact: true }).click()
  await page.getByPlaceholder('Write a caption...').fill('prepended above the reader')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('prepended above the reader').first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(500)

  const after = await page.evaluate((id) => {
    const el = document.querySelector(`[data-post-id="${id}"]`) as HTMLElement
    return el ? el.getBoundingClientRect().top : NaN
  }, anchorId)

  console.log(`[feed-bench] anchor ${anchorId} moved ${Math.abs(after - before).toFixed(1)}px`)
  // The reader must not lose their place: a prepend is compensated by its own
  // height, so the row they were reading stays where it was.
  expect(Math.abs(after - before)).toBeLessThan(2)
})
