import { test, expect } from '@playwright/test'
import { seedApp } from './helpers'

test.describe('Watch tab — browse view clickability', () => {
  test('Create Room card opens the Watch Party modal', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const btn = page.getByLabel('Create a new room')
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
    expect(topText).toContain('Create Room')

    await btn.click()
    // Modal.tsx renders an <h3> title; WatchPartyUrlModal passes 'Watch Party'.
    await expect(page.getByRole('heading', { name: 'Watch Party' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Video URL' })).toBeVisible()
  })

  test('Gallery displays Create Room card in grid', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const createCard = page.getByLabel('Create a new room')
    await expect(createCard).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Start a new watch party')).toBeVisible()
  })
})