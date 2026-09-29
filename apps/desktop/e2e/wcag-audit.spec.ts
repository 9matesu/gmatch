import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { seedApp, mockBooruFeed } from './helpers'

const OUT_DIR = join(process.cwd(), 'test-results', 'audit-screenshots')
mkdirSync(OUT_DIR, { recursive: true })

interface AuditViolation {
  rule: string
  wcagLevel: 'A' | 'AA' | 'AAA' | 'Best Practice'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
  selector: string
  details?: Record<string, unknown>
}

interface ViewAuditResult {
  view: string
  url: string
  violations: AuditViolation[]
}

const auditResults: ViewAuditResult[] = []

async function runWcagAnalysis(page: import('@playwright/test').Page, viewName: string) {
  const violations = await page.evaluate(() => {
    const list: Array<{
      rule: string
      wcagLevel: 'A' | 'AA' | 'AAA' | 'Best Practice'
      severity: 'HIGH' | 'MEDIUM' | 'LOW'
      description: string
      selector: string
      details?: Record<string, unknown>
    }> = []

    function getElementSelector(el: Element): string {
      if (el.id) return `#${el.id}`
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role')
      const testId = el.getAttribute('data-testid')
      if (testId) return `${tag}[data-testid="${testId}"]`
      if (role) return `${tag}[role="${role}"]`
      const className = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
      const name = el.getAttribute('name')
      if (name) return `${tag}[name="${name}"]`
      return `${tag}${className}`
    }

    // 1. Interactive elements without accessible name
    const interactives = Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]'))
    for (const el of interactives) {
      if ((el as HTMLElement).offsetParent === null && !(el as HTMLElement).offsetWidth) continue // hidden
      const ariaLabel = el.getAttribute('aria-label')
      const ariaLabelledby = el.getAttribute('aria-labelledby')
      const title = el.getAttribute('title')
      const text = (el.textContent || '').trim()
      const hasAriaHidden = el.getAttribute('aria-hidden') === 'true'

      let hasName = Boolean(ariaLabel?.trim() || ariaLabelledby?.trim() || title?.trim() || text)
      if (el.tagName.toLowerCase() === 'input') {
        const val = (el as HTMLInputElement).value
        if (val) hasName = true
      }

      if (!hasName) {
        list.push({
          rule: 'WCAG 4.1.2 Name, Role, Value',
          wcagLevel: 'A',
          severity: 'HIGH',
          description: `Interactive element <${el.tagName.toLowerCase()}> has no accessible name (no text, aria-label, aria-labelledby, or title).`,
          selector: getElementSelector(el),
          details: { html: el.outerHTML.slice(0, 150) },
        })
      }

      if (hasAriaHidden) {
        list.push({
          rule: 'WCAG 4.1.2 Name, Role, Value',
          wcagLevel: 'A',
          severity: 'HIGH',
          description: `Focusable interactive element has aria-hidden="true", making it invisible to assistive tech while focusable.`,
          selector: getElementSelector(el),
        })
      }
    }

    // 2. Form controls without associated labels
    const formControls = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea'))
    for (const ctrl of formControls) {
      if ((ctrl as HTMLElement).offsetParent === null && !(ctrl as HTMLElement).offsetWidth) continue
      const id = ctrl.id
      const hasDirectLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false
      const hasParentLabel = Boolean(ctrl.closest('label'))
      const ariaLabel = ctrl.getAttribute('aria-label')
      const ariaLabelledby = ctrl.getAttribute('aria-labelledby')
      const placeholder = ctrl.getAttribute('placeholder')

      if (!hasDirectLabel && !hasParentLabel && !ariaLabel && !ariaLabelledby) {
        list.push({
          rule: 'WCAG 1.3.1 Info and Relationships / 3.3.2 Labels or Instructions',
          wcagLevel: 'A',
          severity: 'HIGH',
          description: `Form control <${ctrl.tagName.toLowerCase()} type="${(ctrl as HTMLInputElement).type}"> lacks an associated <label> or aria-label.${placeholder ? ' Note: placeholder is not a label.' : ''}`,
          selector: getElementSelector(ctrl),
          details: { placeholder, id },
        })
      }
    }

    // 3. Minimum Target Size (WCAG 2.5.8 Target Size Minimum - AA 24x24, Best Practice 40x40/44x44)
    for (const el of interactives) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if ((el as HTMLElement).offsetParent === null) continue

      if (rect.width < 24 || rect.height < 24) {
        list.push({
          rule: 'WCAG 2.5.8 Target Size (Minimum)',
          wcagLevel: 'AA',
          severity: 'MEDIUM',
          description: `Interactive element target size is ${Math.round(rect.width)}x${Math.round(rect.height)}px, smaller than WCAG 24x24px baseline.`,
          selector: getElementSelector(el),
          details: { width: Math.round(rect.width), height: Math.round(rect.height), text: (el.textContent || '').trim().slice(0, 30) },
        })
      } else if (rect.width < 36 || rect.height < 36) {
        list.push({
          rule: 'Target Size Best Practice (Desktop 40px / Touch 44px)',
          wcagLevel: 'Best Practice',
          severity: 'LOW',
          description: `Interactive element is ${Math.round(rect.width)}x${Math.round(rect.height)}px, below recommended 40x40px touch/desktop target comfort.`,
          selector: getElementSelector(el),
          details: { width: Math.round(rect.width), height: Math.round(rect.height), text: (el.textContent || '').trim().slice(0, 30) },
        })
      }
    }

    // 4. ARIA Tablist / Tabs checks
    const tablists = Array.from(document.querySelectorAll('[role="tablist"]'))
    for (const tl of tablists) {
      const tabs = tl.querySelectorAll('[role="tab"]')
      const nonTabButtons = tl.querySelectorAll('button:not([role="tab"])')
      if (tabs.length === 0 && nonTabButtons.length > 0) {
        list.push({
          rule: 'WAI-ARIA APG Tabs Pattern / WCAG 4.1.2',
          wcagLevel: 'A',
          severity: 'HIGH',
          description: `Element with role="tablist" contains buttons without role="tab". Buttons inside tablist must have role="tab" and use aria-selected instead of aria-pressed.`,
          selector: getElementSelector(tl),
        })
      }
    }

    // 5. Images missing alt attribute
    const images = Array.from(document.querySelectorAll('img'))
    for (const img of images) {
      if (!img.hasAttribute('alt')) {
        list.push({
          rule: 'WCAG 1.1.1 Non-text Content',
          wcagLevel: 'A',
          severity: 'HIGH',
          description: `<img> element is missing the alt attribute entirely (must have alt="" if decorative or descriptive text).`,
          selector: getElementSelector(img),
          details: { src: img.src?.slice(0, 100) },
        })
      }
    }

    // 6. Landmark elements
    const mains = document.querySelectorAll('main, [role="main"]')
    if (mains.length === 0) {
      list.push({
        rule: 'WCAG 1.3.1 Info and Relationships / 2.4.1 Bypass Blocks',
        wcagLevel: 'A',
        severity: 'MEDIUM',
        description: `No <main> or role="main" landmark found on this screen. Assistive technologies rely on <main> to jump to primary content.`,
        selector: 'body',
      })
    } else if (mains.length > 1) {
      list.push({
        rule: 'WCAG 1.3.1 Info and Relationships',
        wcagLevel: 'A',
        severity: 'MEDIUM',
        description: `Multiple <main> landmarks found on the page (${mains.length}). Only one primary <main> should be visible.`,
        selector: 'main',
      })
    }

    // 7. Heading hierarchy
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    let prevLevel = 0
    const h1Count = headings.filter(h => h.tagName.toLowerCase() === 'h1').length
    if (h1Count === 0 && interactives.length > 5) {
      list.push({
        rule: 'WCAG 1.3.1 / 2.4.6 Headings and Labels',
        wcagLevel: 'Best Practice',
        severity: 'LOW',
        description: `No <h1> heading found on this screen to identify the primary page purpose.`,
        selector: 'body',
      })
    } else if (h1Count > 1) {
      list.push({
        rule: 'WCAG 1.3.1 Info and Relationships',
        wcagLevel: 'Best Practice',
        severity: 'LOW',
        description: `Multiple (${h1Count}) <h1> headings found on the page. Preferred pattern is exactly one <h1>.`,
        selector: 'h1',
      })
    }

    for (const h of headings) {
      const level = parseInt(h.tagName[1], 10)
      if (prevLevel > 0 && level > prevLevel + 1) {
        list.push({
          rule: 'WCAG 1.3.1 Info and Relationships (Heading hierarchy)',
          wcagLevel: 'Best Practice',
          severity: 'LOW',
          description: `Heading level skipped: <h${prevLevel}> followed by <h${level}> without intermediate level.`,
          selector: getElementSelector(h),
          details: { text: (h.textContent || '').trim().slice(0, 40) },
        })
      }
      prevLevel = level
    }

    // 8. Color Contrast (approximate for visible text elements)
    function parseRgb(colorStr: string): [number, number, number, number] | null {
      const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (!match) return null
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), match[4] !== undefined ? parseFloat(match[4]) : 1]
    }

    function relativeLuminance(r: number, g: number, b: number): number {
      const a = [r, g, b].map(v => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      })
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722
    }

    function contrastRatio(l1: number, l2: number): number {
      const lighter = Math.max(l1, l2)
      const darker = Math.min(l1, l2)
      return (lighter + 0.05) / (darker + 0.05)
    }

    const textNodes = Array.from(document.querySelectorAll('p, span, label, button, a, h1, h2, h3, h4, h5, h6, th, td, div'))
      .filter(el => {
        if ((el as HTMLElement).offsetParent === null) return false
        // Only elements with direct non-empty text
        const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0)
        return hasDirectText
      })
      .slice(0, 100) // sample

    for (const el of textNodes) {
      const style = window.getComputedStyle(el)
      const fgRgb = parseRgb(style.color)
      if (!fgRgb || fgRgb[3] === 0) continue

      // Walk up to find effective background color
      let cur: HTMLElement | null = el as HTMLElement
      let bgRgb: [number, number, number, number] | null = null
      while (cur) {
        const curStyle = window.getComputedStyle(cur)
        const parsed = parseRgb(curStyle.backgroundColor)
        if (parsed && parsed[3] > 0.5) {
          bgRgb = parsed
          break
        }
        cur = cur.parentElement
      }
      if (!bgRgb) bgRgb = [9, 9, 11, 1] // default canvas #09090b

      const fgLum = relativeLuminance(fgRgb[0], fgRgb[1], fgRgb[2])
      const bgLum = relativeLuminance(bgRgb[0], bgRgb[1], bgRgb[2])
      const ratio = contrastRatio(fgLum, bgLum)
      const fontSize = parseFloat(style.fontSize)
      const isBold = parseInt(style.fontWeight, 10) >= 700 || style.fontWeight === 'bold'
      const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold)
      const minRequired = isLargeText ? 3.0 : 4.5

      if (ratio < minRequired) {
        list.push({
          rule: 'WCAG 1.4.3 Contrast (Minimum)',
          wcagLevel: 'AA',
          severity: ratio < 2.5 ? 'HIGH' : 'MEDIUM',
          description: `Low text contrast ${ratio.toFixed(2)}:1 (required ${minRequired}:1). Text: "${(el.textContent || '').trim().slice(0, 30)}"`,
          selector: getElementSelector(el),
          details: { ratio: Number(ratio.toFixed(2)), color: style.color, bg: `rgb(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]})` },
        })
      }
    }

    return list
  })

  auditResults.push({ view: viewName, url: page.url(), violations })
  return violations
}

async function captureScreen(page: import('@playwright/test').Page, name: string) {
  const filePath = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
  console.log(`[Captured] ${name} -> ${filePath}`)
  await runWcagAnalysis(page, name)
}

test.describe('UI/UX & WCAG Comprehensive Audit', () => {
  test.setTimeout(240_000)

  test('01: First-run Age Gate & Legal Center', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    // Open cold without seeds
    await page.goto('/')
    await page.waitForTimeout(1500)
    await captureScreen(page, '01_age_gate')

    // Click legal / privacy / disclaimer if available
    const legalLink = page.getByRole('button', { name: /legal|disclaimer|terms/i }).or(page.getByRole('link', { name: /legal|disclaimer|terms/i })).first()
    if (await legalLink.isVisible()) {
      await legalLink.click()
      await page.waitForTimeout(800)
      await captureScreen(page, '02_legal_center')
    }
    await ctx.close()
  })

  test('02: Idle Clicker Stage (Grid)', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page, { points: 25000 })
    await mockBooruFeed(page)
    await page.goto('/#/grid')
    await page.getByRole('button', { name: /attack the current foe/i }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    await captureScreen(page, '03_idle_grid')
    await ctx.close()
  })

  test('03: Social Feed & Stories', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto('/#/feed')
    await page.waitForTimeout(2000)
    await captureScreen(page, '04_feed')
    await ctx.close()
  })

  test('04: Games Hub & Arena Sub-Tabs', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/games')
    await page.getByRole('tablist', { name: 'Arena Modes' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1000)
    await captureScreen(page, '05_games_arena_1v1')

    // Switch to Rankings
    const rankingsTab = page.getByRole('button', { name: 'Rankings', exact: true }).first()
    if (await rankingsTab.isVisible()) {
      await rankingsTab.click()
      await page.waitForTimeout(800)
      await captureScreen(page, '06_games_rankings')
    }

    // Switch to Babecock
    const babecockTab = page.getByRole('button', { name: 'Babecock', exact: true }).first()
    if (await babecockTab.isVisible()) {
      await babecockTab.click()
      await page.waitForTimeout(800)
      await captureScreen(page, '07_games_babecock')
    }
    await ctx.close()
  })

  test('05: Gallery & Cards', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/gallery')
    await page.waitForTimeout(1500)
    await captureScreen(page, '08_gallery')
    await ctx.close()
  })

  test('06: Messages & Chat', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/messages')
    await page.waitForTimeout(1500)
    await captureScreen(page, '09_messages')
    await ctx.close()
  })

  test('07: User Profile', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/profile')
    await page.waitForTimeout(1500)
    await captureScreen(page, '10_profile')
    await ctx.close()
  })

  test('08: Servers Hub', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/servers')
    await page.waitForTimeout(1500)
    await captureScreen(page, '11_servers')
    await ctx.close()
  })

  test('09: Watch Parties', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/watch')
    await page.waitForTimeout(1500)
    await captureScreen(page, '12_watch')
    await ctx.close()
  })

  test('10: Store & Upgrades', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/store')
    await page.waitForTimeout(1500)
    await captureScreen(page, '13_store')
    await ctx.close()
  })

  test('11: PC Domination Hub', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/pc_domination')
    await page.waitForTimeout(1500)
    await captureScreen(page, '14_pc_domination')
    await ctx.close()
  })

  test('12: Settings & Notifications Overlay', async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 860 } })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/grid')
    await page.waitForTimeout(1500)

    // Open settings button from CommandIsland
    const settingsBtn = page.getByRole('button', { name: /settings/i }).or(page.locator('button[aria-label*="settings" i]')).first()
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      await page.waitForTimeout(1000)
      await captureScreen(page, '15_settings_modal')
    }

    // Save all audit violations to JSON
    const reportPath = join(process.cwd(), 'test-results', 'wcag-findings.json')
    writeFileSync(reportPath, JSON.stringify(auditResults, null, 2), 'utf-8')
    console.log(`[WCAG Audit] Saved findings to ${reportPath}`)

    await ctx.close()
  })
})
