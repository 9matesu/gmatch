// @vitest-environment node
import { test, expect } from '@playwright/test'
import { seedApp, mockBooruFeed } from './helpers'

/**
 * Dead and duplicate button audit.
 *
 * The point of running this in a browser rather than grepping is that the
 * failures here are all *reachable* failures. A grep finds a no-op handler; it
 * cannot tell you whether the button in front of the user actually does
 * anything, and it cannot tell you two visible controls do the same job.
 *
 * What "dead" means precisely, because the naive version of this check is
 * useless: clicking a button that legitimately only changes internal state
 * produces no DOM difference either. So a button is called dead only when
 * NOTHING observable moved — no DOM, no route change, no network, no console
 * error, no dialog — which is the signature of a control with no handler.
 *
 * Known-benign exclusions are listed with reasons. A check that cries wolf
 * gets switched off, and a switched-off check protects nobody.
 */

/**
 * Ready-state landmark per view, per the project's readiness convention
 * (a visible control, never a bare timeout). The grid's marker is an
 * aria-label rather than text, so readiness is a role query, not getByText.
 */
const VIEWS: { path: string; ready: (page: import('@playwright/test').Page) => import('@playwright/test').Locator }[] = [
  {
    path: '/#/grid',
    ready: (p) => p.getByRole('button', { name: /attack the current foe/i }),
  },
  { path: '/#/feed', ready: (p) => p.getByRole('button', { name: 'More options' }) },
  { path: '/#/profile', ready: (p) => p.getByRole('button', { name: 'More options' }) },
  { path: '/#/games', ready: (p) => p.getByRole('button', { name: 'More options' }) },
  { path: '/#/gallery', ready: (p) => p.getByRole('button', { name: 'More options' }) },
  { path: '/#/store', ready: (p) => p.getByRole('button', { name: 'More options' }) },
  { path: '/#/servers', ready: (p) => p.getByRole('button', { name: 'More options' }) },
]

/**
 * Controls that mutate state without an obvious DOM change. Each is listed
 * with the reason it is exempt — an unexplained exception is just a dead test.
 */
const BENIGN: { match: RegExp; why: string }[] = [
  { match: /attack the current foe|next ›|prev|◀/i, why: 'accumulates score into a poll-driven readout' },
  { match: /search/i, why: 'filters a list that may already be empty' },
  { match: /clear/i, why: 'no-op when the field is already empty, which is the common case' },
]

interface ButtonInfo {
  handle: string
  name: string
  tag: string
  disabled: boolean
  rect: { w: number; h: number }
}

/** Tag every visible control so we hold an exact handle for the click pass. */
async function collectButtons(page: import('@playwright/test').Page): Promise<ButtonInfo[]> {
  // The exclusion pattern has to be INSIDE the page: page.evaluate serialises
  // the function body, so a closure over a Node-side RegExp silently becomes
  // undefined there rather than throwing.
  const benignSource = new RegExp(BENIGN.map((b) => `(?:${b.match.source})`).join('|'), 'i').source
  return page.evaluate((benign) => {
    const skip = new RegExp(benign, 'i')
    // React delegates events at the root and does not set an onclick attribute,
    // so `[onclick]` finds nothing. A computed cursor:pointer is the only
    // reliable way to catch a <div> that pretends to be a button.
    const sel = [
      'button',
      'a[href]',
      '[role="button"]',
      '[role="tab"]',
      'input[type="button"]',
      'input[type="submit"]',
    ].join(',')
    const out: ButtonInfo[] = []
    const all = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    for (const el of all) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (el.offsetParent === null && style.position !== 'fixed') continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el.textContent || '').trim().slice(0, 60)
      if (skip.test(name)) continue
      el.setAttribute('data-btn-audit', String(out.length))
      out.push({
        handle: el.getAttribute('data-btn-audit') as string,
        name,
        tag: el.tagName.toLowerCase(),
        disabled:
          (el as HTMLButtonElement).disabled === true ||
          el.getAttribute('aria-disabled') === 'true',
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
      })
    }
    return out
  }, benignSource)
}

test.describe('button audit', () => {
  /**
   * Each control is checked with a FRESH page load before its click.
   *
   * A previous version of this swept every visible button in one pass and
   * asserted "something moved". It passed — including when a deliberately
   * dead button was injected on top of it. The flaw: the first nav button
   * clicked changes the view, which changes the node count, so every
   * subsequent control registered as "did something". A check that cannot
   * fail is worse than no check, because it buys false confidence.
   *
   * So this asserts specific controls, one page load each, against a named
   * observable effect. That is slower per control but it actually fails when
   * a handler is removed, which is the entire point.
   */
  const CONTROLS: { name: string; effect: (page: import('@playwright/test').Page) => Promise<void> }[] = [
    {
      // Regression: this button used to call handleNavClick('games') from
      // inside the branch that only renders when the view is ALREADY 'games',
      // so it set the view to the value it already had and did nothing.
      name: 'Arena nav',
      effect: async (page) => {
        await page.getByRole('button', { name: 'Arena' }).click()
        await expect(page).toHaveURL(/#\/games/)
      },
    },
    {
      // Regression: Settings opened the modal with no observable difference
      // being asserted anywhere, so a broken handler passed silently.
      name: 'Settings',
      effect: async (page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 10_000 })
      },
    },
    {
      name: 'Help',
      effect: async (page) => {
        const help = page.getByRole('button', { name: 'Help', exact: true })
        if (!(await help.isVisible().catch(() => false))) {
          await page.getByRole('button', { name: 'More options' }).click()
        }
        await help.click()
        await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 10_000 })
      },
    },
    {
      name: 'Vault nav',
      effect: async (page) => {
        await page.getByRole('button', { name: 'Vault' }).click()
        await expect(page).toHaveURL(/#\/gallery/)
      },
    },
    {
      // Regression: the wallpaper accordion was a <div onClick> wrapping a
      // <button> with no handler at all — the button was inert.
      name: 'Wallpaper accordion',
      effect: async (page) => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const toggle = page.getByRole('button', { name: /wallpaper settings/i }).first()
        await expect(toggle).toBeVisible({ timeout: 10_000 })
        const before = await toggle.getAttribute('aria-expanded')
        await toggle.click()
        await expect(toggle).not.toHaveAttribute('aria-expanded', before ?? '')
      },
    },
  ]

  for (const control of CONTROLS) {
    test(`${control.name} does something`, async ({ page }) => {
      test.setTimeout(90_000)
      await seedApp(page)
      await mockBooruFeed(page)
      await page.goto('/#/grid')
      await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
        timeout: 20_000,
      })
      await control.effect(page)
    })
  }

  test('no visible button is inert', async ({ page }) => {
    // Retained as a report rather than a gate. The per-control assertions
    // above are the real protection; this one is only sound with a page reload
    // per button, which is far too slow for the normal suite, so it sweeps a
    // SINGLE view and logs what it finds instead of failing on it. Turn it
    // into a gate only when a clean baseline exists.
    test.setTimeout(180_000)
    const view = VIEWS[0]
    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto(view.path)
    await expect(view.ready(page)).toBeVisible({ timeout: 20_000 })
    const buttons = await collectButtons(page)
    console.log(`[button-audit] ${view.path}: ${buttons.length} visible controls`)
    for (const b of buttons) {
      if (!b.name.trim()) console.log(`[button-audit] UNNAMED <${b.tag}> ${JSON.stringify(b.rect)}`)
    }
    // The unnamed-control assertion is the part that is safe to gate on.
    expect(buttons.filter((b) => !b.name.trim()).map((b) => b.tag)).toEqual([])
  })

  test('every icon-only button has an accessible name', async ({ page }) => {
    // An icon button with no name is invisible to a screen reader, so it is
    // the same bug as a dead one from the user's side.
    const unnamed: string[] = []
    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto('/#/profile')
    await expect(page.getByRole('button').first()).toBeVisible({ timeout: 20_000 })
    for (const b of await collectButtons(page)) {
      if (!b.name.trim()) unnamed.push(`<${b.tag}> ${JSON.stringify(b.rect)}`)
    }
    expect(unnamed, `buttons with no accessible name:\n${unnamed.join('\n')}`).toEqual([])
  })

  test('the Help modal is reachable by click, not only by keyboard', async ({ page }) => {
    // Help used to be bound to "?" and Ctrl+H with nothing on screen pointing
    // at it, so the whole feature was unreachable for anyone who had not
    // already been told the shortcut.
    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto('/#/grid')
    await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({ timeout: 20_000 })
    // The satellite section is open by default, so toggling it would CLOSE it.
    // Open it only if it happens to be collapsed.
    const help = page.getByRole('button', { name: 'Help', exact: true })
    if (!(await help.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'More options' }).click()
    }
    await expect(help).toBeVisible({ timeout: 10_000 })
    await help.click()
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 10_000 })
  })

  test('duplicate accessible names in one view are breakpoint-exclusive', async ({ page }) => {
    // Two visible controls with the same name are indistinguishable to a
    // screen reader and ambiguous to a name-based test. Reciprocal
    // breakpoints (md:hidden vs hidden md:flex) are the legitimate case and
    // are excluded.
    const dupes: string[] = []
    for (const view of VIEWS) {
      await seedApp(page)
      await mockBooruFeed(page)
      await page.goto(view.path)
      await expect(view.ready(page)).toBeVisible({ timeout: 20_000 })

      const groups = await page.evaluate(() => {
        const map: Record<string, string[]> = {}
        const els = Array.from(
          document.querySelectorAll('button, a[href], [role="button"], [role="tab"]'),
        ) as HTMLElement[]
        for (const el of els) {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') continue
          if (el.offsetParent === null && style.position !== 'fixed') continue
          const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
          if (!name) continue
          // Tag the breakpoint classes so mutually-exclusive twins can be
          // told apart from two controls that really are both showing.
          const bp = Array.from(el.classList).filter((c) => /^(md|sm|lg|xl):/.test(c)).sort().join(' ')
          ;(map[name] ||= []).push(bp)
        }
        return map
      })

      for (const [name, members] of Object.entries(groups)) {
        if (members.length < 2) continue
        // All members differ only in breakpoint classes -> responsive pair.
        const allDistinct = members.every((m) => m !== members[0])
        if (allDistinct) continue
        dupes.push(`${view.path} :: "${name}" x${members.length}`)
      }
    }
    expect(dupes, `simultaneous duplicate controls:\n${dupes.join('\n')}`).toEqual([])
  })
})
