import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * Spacing audit: real content collisions between adjacent siblings.
 *
 * Overflow is one half of "everything spaced, nothing crammed"; the other half
 * is boxes that physically overlap. Only collisions that matter are counted:
 *  - decorative layers are excluded (`absolute`, `fixed`, `pointer-events-none`,
 *    `aria-hidden`), because a badge over a card or a backdrop is legitimate
 *  - SVG internals are excluded (their children are geometry, not layout)
 *  - the floating dock/island is excluded (it is designed to float above)
 *  - only NON-INLINE elements with text/media content are compared
 *
 * What remains is a genuine "two pieces of content occupy the same pixels".
 */
test('no content collisions between adjacent siblings', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route(/\/api\/.*$/, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await seedApp(page)
  await page.goto('/#/feed')
  await page.waitForTimeout(2500)

  const report = await page.evaluate(() => {
    type Hit = { parent: string; a: string; b: string; gap: number }
    const hits: Hit[] = []
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`

    // A layer that is positioned out of flow is not part of the content row.
    const isDecorative = (el: Element): boolean => {
      const cs = getComputedStyle(el)
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') return true
      if (cs.pointerEvents === 'none') return true
      if (el.getAttribute('aria-hidden') === 'true') return true
      if (el.closest('[aria-hidden="true"]')) return true
      // SVG geometry: children are paths/rects, not layout boxes.
      if (el.closest('svg')) return true
      // The floating command island / dock floats above the page by design.
      if (el.closest('nav') || el.classList.contains('command-island')) return true
      return false
    }

    for (const parent of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (isDecorative(parent)) continue
      const kids = Array.from(parent.children).filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        if (isDecorative(el)) return false
        // Must carry something visible: text or replaced content.
        const hasText = (el.textContent || '').trim().length > 0
        const hasMedia = !!el.querySelector('img, video, canvas, svg')
        return hasText || hasMedia
      }) as HTMLElement[]
      if (kids.length < 2) continue

      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i].getBoundingClientRect()
        const b = kids[i + 1].getBoundingClientRect()
        // Same row only: vertically stacked siblings are a normal column.
        const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (vOverlap <= 0) continue
        const gap = Math.round((b.left - a.right) * 10) / 10
        if (gap < -1) {
          hits.push({ parent: label(parent), a: label(kids[i]), b: label(kids[i + 1]), gap })
        }
      }
    }
    return hits.slice(0, 20)
  })

  if (report.length > 0) {
    console.log('[spacing] content collisions:')
    for (const h of report) {
      console.log(`[spacing] ${h.parent} :: ${h.a} overlaps ${h.b} by ${Math.abs(h.gap)}px`)
    }
  } else {
    console.log('[spacing] no content collisions')
  }
  expect(report, 'no two pieces of content may overlap').toHaveLength(0)
})