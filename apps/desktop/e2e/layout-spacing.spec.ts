import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * Spacing audit: elements that are ADJACENT but TOUCHING.
 *
 * Overflow is one half of "everything spaced, nothing crammed"; the other half
 * is elements whose boxes collide or nearly collide. This measures, for every
 * pair of siblings that share a parent and sit on the same row, the horizontal
 * gap between them — and reports anything below a threshold.
 *
 * It is a measurement, not a style opinion: it finds collisions, not "too tight".
 */
test('no sibling collisions in the primary surfaces', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route(/\/api\/.*$/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await seedApp(page)
  await page.goto('/#/feed')
  await page.waitForTimeout(2500)

  const report = await page.evaluate(() => {
    type Hit = { parent: string; a: string; b: string; gap: number; overlap: number }
    const hits: Hit[] = []
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`

    for (const parent of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      // Only real layout containers: skip inline wrappers and the whole document.
      const kids = Array.from(parent.children).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }) as HTMLElement[]
      if (kids.length < 2) continue

      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].getBoundingClientRect()
        const b = kids[i + 1].getBoundingClientRect()
        // Same row only: overlapping vertically means they are stacked, which is
        // a different (and legitimate) arrangement.
        const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (vOverlap <= 0) continue
        const gap = Math.round((b.left - a.right) * 10) / 10
        // A NEGATIVE gap means the boxes physically overlap: a real collision.
        if (gap < 0) {
          hits.push({ parent: label(parent), a: label(kids[i]), b: label(kids[i + 1]), gap, overlap: vOverlap })
        }
      }
    }
    return hits.slice(0, 20)
  })

  if (report.length > 0) {
    console.log('[spacing] sibling overlaps:')
    for (const h of report) {
      console.log(`[spacing] ${h.parent} :: ${h.a} overlaps ${h.b} by ${Math.abs(h.gap)}px`)
    }
  } else {
    console.log('[spacing] no sibling overlaps')
  }
  expect(report, 'no two adjacent siblings may overlap').toHaveLength(0)
})