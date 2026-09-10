import { expect, test } from '@playwright/test'
import { seedApp, mockBooruFeed } from './helpers'

// Memory census (perf checkup): walks the real UI, samples the JS heap over
// CDP, and keeps a growth tripwire in the suite. Baseline numbers live in
// docs/PERF.md; the threshold there should be re-calibrated whenever the
// baseline changes materially.
test('memory baseline: heap growth under 60s of idle clicking', async ({ page }) => {
  test.setTimeout(180_000)
  const cdp = await page.context().newCDPSession(page)
  await seedApp(page, { gc: 50000 })
  await mockBooruFeed(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await stage.waitFor({ timeout: 30_000 })

  const sample = async (): Promise<number> => {
    const mib = await page.evaluate(() => (performance as unknown as {
      memory?: { usedJSHeapSize: number }
    }).memory?.usedJSHeapSize)
    if (typeof mib === 'number') return mib
    const r = (await cdp.send('Runtime.getHeapUsage' as never)) as { usedSize: number }
    return r.usedSize
  }

  const marks: number[] = []
  for (let i = 0; i < 60; i++) {
    await stage.click()
    if (i % 10 === 9) marks.push(await sample())
    await page.waitForTimeout(300)
  }
  // Feed + view churn: the poll paths most likely to leak.
  await page.goto('/#/feed')
  await page.waitForTimeout(4000)
  await page.goto('/#/games')
  await page.waitForTimeout(4000)
  const end = await sample()

  await cdp.send('HeapProfiler.collectGarbage' as never)
  const afterGc = await sample()

  console.log(
    'HEAP marks(MiB):',
    marks.map((m) => (m / 1048576).toFixed(1)).join(' → '),
    '| end:', (end / 1048576).toFixed(1),
    '| post-GC:', (afterGc / 1048576).toFixed(1),
    'MiB',
  )
  // Tripwire: total growth from first mark must stay < 60 MiB (recalibrate
  // against docs/PERF.md baseline; generous until the baseline is recorded).
  expect(end - marks[0]).toBeLessThan(60 * 1048576)
  // Retained-after-GC must be well under the marks ceiling (real leaks keep
  // their memory even after collection).
  expect(afterGc).toBeLessThan(120 * 1048576)
})
