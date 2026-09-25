import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'
import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

test.describe('v1.5.1 features and regressions', () => {
  test('changelog modal opens on first launch and persists dismissal', async ({ page }) => {
    const identity = generateIdentity()
    const idleSave = {
      version: 3,
      points: 1000,
      totalEarned: 1000,
      xp: 0,
      clickCount: 0,
      critCount: 0,
      shards: 0,
      prestigeCount: 0,
      tags: [],
      gallery: [],
      caps: [],
      capsUsed: [],
      achievements: [],
      collectedOfflineEarnings: true,
      ageAccepted: true,
      defeated: 0,
      backgroundUrl: null,
      viewMode: 'single',
      setupComplete: true,
      userExcludes: [],
      lastSeenAt: Date.now(),
    }

    // Seed without setting gmatch_last_seen_changelog
    await page.addInitScript(
      ([id, save, LEGAL_KEY]: [Record<string, unknown>, Record<string, unknown>, string]) => {
        localStorage.setItem('orbit_identity', JSON.stringify(id))
        localStorage.setItem('goonMatch_age_verified', 'true')
        localStorage.setItem('orbit_legal_accepted', LEGAL_KEY)
        localStorage.setItem('orbit_display_name', 'Changelog Tester')
        localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
        localStorage.setItem(`gmatch.save.v1:${id.orbitId}`, JSON.stringify(save))
        localStorage.setItem('gmatch.save.v1', JSON.stringify(save))
        localStorage.setItem(
          `orbit_onboarding_v2:${id.orbitId}`,
          JSON.stringify({
            version: 1,
            current: 'ready',
            completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'],
          }),
        )
      },
      [identity, idleSave, legalVersionKey()],
    )

    await page.goto('/#/servers')

    // Changelog modal should appear automatically
    const dialog = page.getByRole('dialog', { name: /What's New in version 1.5.1/i })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: "What's New" })).toBeVisible()
    await expect(page.getByText('Watch Party Theater')).toBeVisible()

    // Dismiss by clicking the Got it button
    const gotItBtn = page.getByRole('button', { name: 'Got it' })
    await gotItBtn.click()
    await expect(dialog).not.toBeVisible()

    // Verify localStorage has 1.5.1
    const stored = await page.evaluate(() => localStorage.getItem('gmatch_last_seen_changelog'))
    expect(stored).toBe('1.5.1')

    // Reload page -> modal should NOT reopen
    await page.reload()
    await expect(page.getByRole('dialog', { name: /What's New in version 1.5.1/i })).not.toBeVisible()
  })

  test('changelog can be reopened from settings What\'s New button', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/servers')

    const settingsBtn = page.getByLabel('Settings')
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 })
    await settingsBtn.click()

    const whatsNewBtn = page.getByRole('button', { name: /What's New/i })
    await expect(whatsNewBtn).toBeVisible({ timeout: 15_000 })
    await whatsNewBtn.click()

    const dialog = page.getByRole('dialog', { name: /What's New in version 1.5.1/i })
    await expect(dialog).toBeVisible()

    // Close via close X button
    const closeBtn = page.getByRole('button', { name: 'Close changelog' })
    await closeBtn.click()
    await expect(dialog).not.toBeVisible()
  })

  test('onboarding starts directly on profile/handle without server step', async ({ page }) => {
    // Only verify legal acceptance and age verification, but NO completed onboarding
    const identity = generateIdentity()
    await page.addInitScript(
      ([id, LEGAL_KEY]: [Record<string, unknown>, string]) => {
        localStorage.setItem('orbit_identity', JSON.stringify(id))
        localStorage.setItem('goonMatch_age_verified', 'true')
        localStorage.setItem('orbit_legal_accepted', LEGAL_KEY)
        // No display name set, so user enters onboarding ProfileStep
        localStorage.removeItem('orbit_display_name')
        localStorage.removeItem(`orbit_onboarding_v2:${id.orbitId}`)
        localStorage.setItem('gmatch_last_seen_changelog', '1.5.1')
      },
      [identity, legalVersionKey()],
    )

    await page.goto('/')

    // Should render the profile setup / choose handle directly
    await expect(page.getByRole('heading', { name: /Set up your profile/i })).toBeVisible({ timeout: 15_000 })
    // Verify there is no server selection step shown
    await expect(page.getByText(/Choose a Home Server/i)).not.toBeVisible()
  })
})
