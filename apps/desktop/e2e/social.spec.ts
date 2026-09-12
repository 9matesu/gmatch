import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'
import { generateIdentity } from '../src/identity.cjs'

import { legalVersionKey } from '../src/legal/documents'

// Release-1.0 social-suite journeys (plan P4.1).
// SWs blocked: service-worker caching breaks route mocks + identity seeding
// determinism (same reason as journeys.spec.ts).
test.use({ contextOptions: { serviceWorkers: 'block' } })

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Register a fresh identity with the dev API + seed the shell's local state,
// then drive it from its own page context (orbitAuth auto-creates Users rows).
async function newPeerContext(page: import('@playwright/test').Page, name: string) {
  const id = generateIdentity()
  const ctx = await page.context().browser()!.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.addInitScript(
    ([i, n, legalKey]: [Record<string, unknown>, string, string]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(i))
      localStorage.setItem('goonMatch_age_verified', 'true')

      localStorage.setItem('orbit_legal_accepted', legalKey)

      localStorage.setItem('orbit_display_name', n)
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      localStorage.setItem(
        `orbit_onboarding_v2:${i.orbitId}`,
        JSON.stringify({ version: 1, current: 'ready', completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'] }),
      )
    },
    [id, name, legalVersionKey()],
  )
  return { ctx, p, id }
}

async function publishPost(page: import('@playwright/test').Page, caption: string) {
  await page.goto('/#/feed')
  await page.getByRole('button', { name: 'Create post', exact: true }).click()
  const drop = page.getByText('Drag & drop photos or click to browse')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  // Real user flow: clicking the dropzone opens the OS file chooser; other
  // hidden inputs on the page make setInputFiles().first() ambiguous.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    drop.click(),
  ])
  await chooser.setFiles({ name: 'e2e-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
  // The 1.0.x composer crops every upload: apply the default crop first.
  const apply = page.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toBeVisible({ timeout: 10_000 })
  await apply.click()
  await page.getByPlaceholder('Write a caption...').fill(caption)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('Post shared.')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache
  await page.reload()
  await expect(page.getByText(caption).first()).toBeVisible({ timeout: 20_000 })
}

test('journey 1: publish a post from Create and see it in the feed', async ({ page }) => {
  await seedApp(page)
  await publishPost(page, `e2e post ${Date.now()}`)
})

test('journey 2: like + comment round trip on a post', async ({ page }) => {
  await seedApp(page)
  const caption = `comment target ${Date.now()}`
  await publishPost(page, caption)
  await page.locator('button[aria-label="Like post"]').first().click()
  // Comment button opens the post lightbox; the lightbox carries its own
  // comment composer (CommentsModal's placeholder lives in the DM/chat sheet).
  await page.locator('button[aria-label="Comment"]').first().click()
  const box = page.getByPlaceholder('Add a comment...')
  await expect(box).toBeVisible({ timeout: 15_000 })
  const text = `e2e comment ${Date.now()}`
  await box.fill(text)
  await box.press('Enter')
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 })
})

test('journey 3: DM a peer and both sides see the message', async ({ page }) => {
  await seedApp(page)
  const peerName = `E2E Peer ${Date.now()}`
  const { ctx: ctxB, p: pageB } = await newPeerContext(page, peerName)
  await pageB.goto('/#/profile')
  await expect(pageB.getByText(peerName).first()).toBeVisible({ timeout: 25_000 })

  await page.goto('/#/messages')
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeVisible({ timeout: 20_000 })
  await search.fill(peerName)
  const peerRow = page.getByText(peerName).first()
  await expect(peerRow).toBeVisible({ timeout: 20_000 })
  await peerRow.click()
  const msg = `ping ${Date.now()}`
  const composer = page.getByPlaceholder(/^Message /).or(page.getByPlaceholder('Message...'))
  await composer.fill(msg)
  await page.keyboard.press('Enter')
  await expect(page.getByText(msg).first()).toBeVisible({ timeout: 15_000 })

  await pageB.goto('/#/messages')
  await expect(pageB.getByText(msg).first()).toBeVisible({ timeout: 25_000 })
  await ctxB.close()
})

test('journey 4: view a post author profile from the feed', async ({ page }) => {
  // Share-DM + permalink are covered by RTL (SharePostModal.test) and the pm
  // round trip by journey 3; this closes the profile-viewing loop instead of
  // a contrived follow-seeding dance.
  await seedApp(page)
  const caption = `profile probe ${Date.now()}`
  await publishPost(page, caption)
  await page.getByText(caption).first().click() // open the post lightbox
  // The 1.1 lightbox header exposes the author as a clickable avatar strip
  // titled "View profile" (a div, not a button) — open the profile via that.
  const author = page.getByTitle(/View profile|Watch story/i).first()
  await expect(author).toBeVisible({ timeout: 15_000 })
  await author.click()
  await expect(page.getByText(/Follow|posts|Following/i).first()).toBeVisible({ timeout: 15_000 })
})

test('journey 5: store renders priced items from the server', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/store')
  await expect(page.locator('text=/g\\$\\s?[\\d.,]+/').first()).toBeVisible({ timeout: 25_000 })
})

test('journey 6: admin route shows the PIN gate (reachable, not dead)', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/admin')
  await expect(page.getByText('Admin Operations')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByPlaceholder('Secret Passcode')).toBeVisible()
})
