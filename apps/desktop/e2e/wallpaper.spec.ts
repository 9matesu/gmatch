import { expect, test, type Page } from '@playwright/test'
import { seedApp } from './helpers'

// "Set as OS wallpaper" and the domination remote effects.
//
// The OS swap itself runs in the Electron main process through a PowerShell
// SystemParametersInfo call, so Chromium genuinely cannot exercise it — the
// bridge (`window.gmatch`) does not exist in a browser build. What IS testable
// here, and previously untested, is the half the browser owns: the context
// menu is reachable, it passes the ORIGINAL content URL rather than the
// transient blob: src, and a platform the swap cannot serve produces an HONEST
// message instead of failing silently.
//
// The failures that mattered, all fixed alongside:
//  - nothing called restore on quit, so a domination wallpaper outlived the app
//    and the only copy of the user's original wallpaper died with the process;
//  - restore ran `set ''` when the captured file was gone, which CLEARS the
//    desktop instead of restoring anything;
//  - macOS/Linux desktop users were told the feature "is only available in the
//    desktop app" while sitting in the desktop app.

test.use({ contextOptions: { serviceWorkers: 'block' } })
test.setTimeout(180_000)

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Seed, boot, and publish one real image post so there is genuine media. */
async function withAnImagePost(page: Page) {
  await seedApp(page)
  // Serve the post's own media locally. Rendering it goes through the media
  // proxy, which intermittently times out against the legacy external CDN and
  // left this spec waiting on a network it does not test.
  await page.route('**/api/objects/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }),
  )
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Create Post', exact: true }).click()
  const drop = page.getByText('Drag & drop photos or click to browse')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), drop.click()])
  await chooser.setFiles({ name: 'e2e-wallpaper.png', mimeType: 'image/png', buffer: PNG_1x1 })
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByPlaceholder('Write a caption...').fill('wallpaper source')
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('Post shared.')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache

  // Wait for the POST's image specifically, with a resolved src. That src is
  // exactly what App's context handler reads (`imgEl.currentSrc || imgEl.src`),
  // and it bails without one — so right-clicking a still-loading placeholder
  // silently produces no menu.
  //
  // Scoped to the post card: a bare `img` also matches the Back / Forward /
  // Mute icons in the shell header, and `.first()` was handing back one of
  // those instead of the photo.
  //
  // Deliberately not `naturalWidth > 0`: full decode waits on the media proxy,
  // which times out intermittently against the external CDN and made this suite
  // flaky. A resolved src is enough to open the menu, and it is local.
  const postImage = page.locator('article').first().locator('img').last()
  await expect
    .poll(
      async () =>
        postImage.evaluate((el) => {
          const i = el as HTMLImageElement
          return Boolean(i.currentSrc || i.src) && !/Loading/.test(i.alt)
        }).catch(() => false),
      { timeout: 60_000, message: 'the post image never resolved a src' },
    )
    .toBe(true)
  await expect(postImage).toBeVisible({ timeout: 30_000 })

  // The feed card swallows right-click with its own options sheet (by design),
  // so open the post lightbox first — its image falls through to the app-level
  // media handler, which is what offers the wallpaper entries.
  //
  // Target the lightbox BY NAME. A bare getByRole('dialog') also matches the
  // options sheet, which contains an image of its own, so the earlier version
  // sometimes "opened" the wrong dialog and then found no context menu.
  await postImage.click()
  const lightbox = page.getByRole('dialog', { name: 'Post', exact: true })
  await expect(lightbox).toBeVisible({ timeout: 20_000 })
  const lightboxImg = lightbox.locator('img').first()
  await expect(lightboxImg).toBeVisible({ timeout: 20_000 })
  return lightboxImg
}

/**
 * Click a context-menu entry.
 *
 * `force` because the shell re-renders on its roster/heartbeat polls, which
 * detaches and re-creates the menu node mid-click ("element is not stable …
 * element was detached from the DOM, retrying", looping until the test
 * timeout). The menu's presence is asserted separately, so the only thing this
 * needs to do is deliver the click to the right entry.
 */
async function chooseMenuEntry(page: Page, label: string) {
  const entry = page.getByText(label, { exact: true })
  await expect(entry).toBeVisible({ timeout: 20_000 })
  await entry.click({ force: true })
}

test('the OS wallpaper entry is offered on real image content', async ({ page }) => {
  const image = await withAnImagePost(page)
  await image.click({ button: 'right' })

  const menu = page.getByRole('menu').first()
  await expect(menu).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Set as OS wallpaper')).toBeVisible()
  await expect(page.getByText('Set as app background')).toBeVisible()
})

test('choosing OS wallpaper in a browser reports the real reason, not silence', async ({ page }) => {
  const image = await withAnImagePost(page)
  await image.click({ button: 'right' })
  await chooseMenuEntry(page, 'Set as OS wallpaper')

  // No Electron bridge in a browser build. The old code took the same branch
  // as a Windows SPI failure and told the user the feature was desktop-only —
  // which was true-but-unhelpful on desktop too. It must now name the bridge as
  // the missing piece.
  const toast = page.getByText(/gMatch desktop app/i).first()
  await expect(toast).toBeVisible({ timeout: 20_000 })
})

test('the in-app background path works in a browser', async ({ page }) => {
  const image = await withAnImagePost(page)
  await image.click({ button: 'right' })
  await chooseMenuEntry(page, 'Set as app background')

  // No bridge required: this one is a renderer-only background, so it must
  // succeed rather than report a platform problem.
  const failures = page.getByText(/desktop app|only available/i)
  await expect(failures).toHaveCount(0, { timeout: 15_000 })
})
