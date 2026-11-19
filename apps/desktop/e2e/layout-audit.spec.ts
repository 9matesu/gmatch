import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * Layout audit: no horizontal overflow, at any breakpoint, on every view.
 *
 * This is a MEASUREMENT, not a screenshot review: it reports every element whose
 * box leaves the viewport, and the outermost offender is the cause (a child of an
 * overflowing box is collateral). The doc-level `scrollWidth` is the real
 * contract — a page that never scrolls sideways has no overflow, whatever a
 * nested scroller does.
 */
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const VIEWS = ['#/feed', '#/games', '#/messages', '#/servers', '#/profile']

test('no horizontal overflow on any view at any breakpoint', async ({ page }) => {
  test.setTimeout(240_000)

  await page.route(/\/api\/.*$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))

  const offenders: string[] = []

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const view of VIEWS) {
      await seedApp(page)
      await page.goto('/' + view)
      await page.waitForTimeout(1800)

      const report = await page.evaluate(() => {
        const vw = window.innerWidth
        const over = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.right > vw + 1
        })
        // Outermost only: if the parent is also over, the child is not the cause.
        const outer = over.filter((el) => {
          const pr = el.parentElement?.getBoundingClientRect()
          return !(pr && pr.right > vw + 1)
        })
        return {
          vw,
          docScroll: document.documentElement.scrollWidth,
          outer: outer.slice(0, 4).map((el) =>
            `${el.tagName}.${String(el.className).slice(0, 70)} right=${Math.round(el.getBoundingClientRect().right)}`),
        }
      })

      const label = `${vp.name} ${view}`
      if (report.docScroll > report.vw + 1 || report.outer.length > 0) {
        offenders.push(`${label}: docScroll=${report.docScroll} vw=${report.vw} :: ${report.outer.join(' | ')}`)
      }
      // The contract: the PAGE never scrolls sideways.
      expect(report.docScroll, `${label} document scrollWidth`).toBeLessThanOrEqual(report.vw + 1)
    }
  }

  if (offenders.length > 0) {
    console.log('[overflow] offenders (outermost, per view):')
    for (const o of offenders) console.log('[overflow] ' + o)
  } else {
    console.log('[overflow] clean at every breakpoint and view')
  }
})

test('the mobile dock stays inside the viewport', async ({ page }) => {
  // Regression: the command island centred with `left-1/2` hung off the right
  // edge (measured: right=853 at a 768px viewport). It must never leave the box.
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.route(/\/api\/.*$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await seedApp(page)
  await page.goto('/#/feed')
  await expect(page.locator('nav[aria-label="Command Island"]')).toBeVisible({ timeout: 30_000 })

  const box = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Command Island"]') as HTMLElement | null
    if (!nav) return null
    const r = nav.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }
  })
  expect(box).not.toBeNull()
  expect(box!.left).toBeGreaterThanOrEqual(0)
  expect(box!.right).toBeLessThanOrEqual(box!.vw)
})