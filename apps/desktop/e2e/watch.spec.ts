import { test, expect } from '@playwright/test'
import { seedApp } from './helpers'

test.describe('Watch tab — browse view clickability', () => {
  test('START A PARTY opens the Watch Party modal', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const btn = page.getByRole('button', { name: /START A PARTY/i })
    // Cold start (vite + bun sidecar) can take >5s before the tab hydrates.
    await expect(btn).toBeVisible({ timeout: 15_000 })

    // Hit-test: the button (or a descendant) must be the topmost element at
    // its own center pixel.
    const box = await btn.boundingBox()
    const topText = await page.evaluate(
      ([x, y]: [number, number]) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return (el?.closest('button')?.textContent || el?.tagName || '').trim()
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    )
    expect(topText.toUpperCase()).toContain('START A PARTY')

    await btn.click()
    // Modal.tsx renders an <h3> title; WatchPartyUrlModal passes 'Watch Party'.
    await expect(page.getByRole('heading', { name: 'Watch Party' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Video URL' })).toBeVisible()
  })

  test('Join button with a bad room code shows the inline error', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const input = page.getByRole('textbox', { name: 'Join by room code' })
    await expect(input).toBeVisible()
    await input.fill('00000000')
    await page.getByRole('button', { name: /^Join$/ }).click()
    await expect(page.getByText(/No room with that code/i)).toBeVisible()
  })
})