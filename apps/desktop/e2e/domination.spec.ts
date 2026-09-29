import { expect, test, type Page } from '@playwright/test'
import { seedApp, firstRunOverlayKeys } from './helpers'
import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

// PC Domination end to end: one player opts in, another sends a consented
// effect, and it lands on the first player's screen.
//
// This had ZERO e2e. The server had 12 unit tests and the client had a
// constants-only test that rendered nothing, so the entire inbound path —
// consent gate, target list, the send modal, the WebSocket delivery, the effect
// renderer, the ack — was never exercised end to end. Every one of those is a
// place where the feature can be 100% "implemented" and still do nothing.

test.use({ contextOptions: { serviceWorkers: 'block' } })
test.setTimeout(300_000)

const VICTIM = 'Dom Victim'
const ATTACKER = 'Dom Attacker'

/** A second signed-in identity with first-run overlays dismissed. */
async function newPeer(browser: import('@playwright/test').Browser, name: string) {
  const id = generateIdentity()
  const ctx = await browser.newContext({ serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.addInitScript(
    ([i, n, legalKey, overlayKeys]: [Record<string, unknown>, string, string, [string, string][]]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(i))
      localStorage.setItem('goonMatch_age_verified', 'true')
      localStorage.setItem('orbit_legal_accepted', legalKey)
      localStorage.setItem('orbit_display_name', n)
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      for (const [k, v] of overlayKeys) localStorage.setItem(k, v)
    },
    [id, name, legalVersionKey(), firstRunOverlayKeys(id.orbitId)],
  )
  return { ctx, page, id }
}

/** Boot the shell; the signed boot request registers the Users row. */
async function boot(page: Page) {
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

/** Name the account server-side, the way completing onboarding does. */
async function nameSelf(page: Page, displayName: string) {
  await page.evaluate(async (name: string) => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    await mod.orbitFetch(
      '/api/users/profile',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: name }) },
      ident,
    )
  }, displayName)
}

/** Open the Domination tab. */
async function openDomination(page: Page) {
  await page.goto('/#/pc_domination')
  await expect(page.getByRole('tablist', { name: 'Domination categories' })).toBeVisible({ timeout: 30_000 })
}

/** Turn on Receiving plus the Message consent, through the real switches. */
async function optIn(page: Page) {
  await openDomination(page)
  const master = page.getByRole('switch', { name: 'Receive domination effects' })
  await expect(master).toBeVisible({ timeout: 20_000 })
  if ((await master.getAttribute('aria-checked')) !== 'true') await master.click()
  await expect(master).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })

  // The per-effect consent is separate: the master switch alone leaves every
  // individual effect refused. Scope to the consent section, because the
  // Send section has a "Message" effect button with the same name.
  await page.getByRole('tab', { name: 'My consent' }).click()
  const consent = page.getByRole('region', { name: 'My consent' })
  const message = consent.getByRole('switch', { name: 'Message', exact: true })
  await expect(message).toBeVisible({ timeout: 20_000 })
  if ((await message.getAttribute('aria-checked')) !== 'true') await message.click()
  await expect(message).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
}

/** The sendable effect buttons live in the Send section. */
function sendSection(page: Page) {
  return page.getByRole('region', { name: 'Send' })
}

/**
 * Give a peer wallet g$, the way an admin would.
 *
 * There is no client-reachable way to earn g$ cheaply: the only flows that
 * credit a wallet are card-tier match payouts and moderation rewards, both far
 * too heavy for a smoke test. `seedApp`'s `points` are the CLIENT idle game and
 * never reach the server wallet, so a domination send is 402 without this.
 *
 * The e2e sidecar pins its own ADMIN_PIN in playwright.config.ts, so this
 * does not depend on the dev default or on any local .env file. The grant is
 * host-is-admin, expires after 12h, and is confined to the throwaway database
 * that GMATCH_API_FRESH wipes before every run.
 */
export const E2E_ADMIN_PIN = 'e2e-admin-pin'

async function fundWallet(page: Page, targetId: string, amount = 5000) {
  const result = await page.evaluate(
    async ([id, gcoins, pin]: [string, number, string]) => {
      const mod = await import('/src/utils/api.ts')
      const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const verify = await mod.orbitFetch(
        '/api/admin/verify-pin',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) },
        ident,
      )
      if (!verify.ok) return { step: 'verify-pin', status: verify.status, body: await verify.text() }
      const adj = await mod.orbitFetch(
        `/api/admin/users/${id}/adjust`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add_gcoins: gcoins }) },
        ident,
      )
      return { step: 'adjust', status: adj.status, body: await adj.text() }
    },
    [targetId, amount, E2E_ADMIN_PIN] as [string, number, string],
  )
  expect(result.status, `fundWallet failed at ${result.step}: ${result.status} ${result.body}`).toBeLessThan(300)
}

test('a consented domination effect is delivered to the target', async ({ page, browser }) => {
  const victim = await newPeer(browser, VICTIM)
  try {
    await boot(victim.page)
    await nameSelf(victim.page, VICTIM)
    await optIn(victim.page)

    // The attacker needs wallet g$: the cheapest effect is 250 and the only
    // client-reachable earnings are card-tier payouts, so fund it as an admin.
    const attacker = await seedApp(page, { points: 5000 })
    await boot(page)
    await nameSelf(page, ATTACKER)
    await openDomination(page)

    // Pick the victim from the live target list. Without consent + pc_domination
    // enabled, the server returns 403 and nothing is charged.
    const target = page.getByRole('button', { name: new RegExp(VICTIM) }).first()
    await expect(target).toBeVisible({ timeout: 45_000 })
    // Fund the SENDER. The wallet is per-identity, and it is the attacker who
    // pays — crediting the victim here makes every send 402.
    await fundWallet(page, attacker.orbitId)
    await target.click()

    const effect = sendSection(page).getByRole('button', { name: /Message/ }).first()
    await expect(effect).toBeEnabled({ timeout: 20_000 })
    await effect.click()

    const dialog = page.getByRole('dialog', { name: /Message settings/ })
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await dialog.getByPlaceholder('What they will see').fill('hello from the e2e suite')
    // Default is 10s and the effect self-dismisses, so the window to assert on
    // it is short. Push the duration to max so the assertion is not racing a
    // timer.
    await dialog.getByLabel('Duration').fill('60')
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()

    // Probe both ends before asserting UI, so a failure says WHERE it broke:
    // the victim's stored consent, and what the sender sees for that target.
    const [settings, probe] = await Promise.all([
      victim.page.evaluate(async () => {
        const mod = await import('/src/utils/api.ts')
        const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
        const r = await mod.orbitFetch('/api/domination/settings', {}, ident)
        return r.json()
      }),
      page.evaluate(async (name: string) => {
        const mod = await import('/src/utils/api.ts')
        const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
        const r = await mod.orbitFetch('/api/domination/targets', {}, ident)
        const d = (await r.json()) as {
          targets?: Array<{ id: string; displayName: string; consents?: Record<string, boolean> }>
        }
        const t = (d.targets ?? []).find((x) => x.displayName === name)
        return { status: r.status, target: t }
      }, VICTIM),
    ])
    expect(
      probe.target?.consents?.allowPopupMessage === true &&
        (settings as { settings?: { allowPopupMessage?: boolean } }).settings?.allowPopupMessage === true,
      `DOMINATION PROBE\nsettings=${JSON.stringify(settings)}\nprobe=${JSON.stringify(probe)}`,
    ).toBe(true)

    // The effect must LAND on the victim. Assert on the victim FIRST: the send
    // dialog closing is not evidence of anything, and the overlay expires.
    await expect(victim.page.getByText('hello from the e2e suite')).toBeVisible({ timeout: 45_000 })

    // The send must be ACCEPTED and CHARGED, not silently refused. 402/403 here
    // is the feature quietly doing nothing.
    const bal = await page.evaluate(async () => {
      const mod = await import('/src/utils/api.ts')
      const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const r = await mod.orbitFetch('/api/economy/balance', {}, ident)
      return (await r.json()) as { balance: number }
    })
    expect(bal.balance, 'the message effect was not charged to the sender').toBeLessThan(5000)

    // The send must be ACCEPTED, not silently refused — a 403/402 is the
    // feature quietly doing nothing.
    await expect(dialog).not.toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Not enough g\$|Could not send|has not allowed/i)).toHaveCount(0, { timeout: 20_000 })

    // The sender's History should record it as delivered, not pending forever.
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText(VICTIM)).toBeVisible({ timeout: 20_000 })
  } finally {
    await victim.ctx.close()
  }
})

test('an effect is refused and nothing is charged when consent is off', async ({ page, browser }) => {
  const victim = await newPeer(browser, 'Dom Silent')
  try {
    await boot(victim.page)
    await nameSelf(victim.page, 'Dom Silent')
    // Deliberately NOT opting in: pc_domination_enabled stays false, so the
    // server must refuse at /api/domination/trigger with 403.

    await seedApp(page, { points: 5000 })
    await boot(page)
    await nameSelf(page, ATTACKER)
    await openDomination(page)

    const target = page.getByRole('button', { name: /Dom Silent/ }).first()
    await expect(target).toBeVisible({ timeout: 45_000 })
    await target.click()

    // A non-consenting player is not even offered an enabled effect.
    const effect = sendSection(page).getByRole('button', { name: /Message/ }).first()
    await expect(effect).toBeDisabled({ timeout: 20_000 })

    // The victim sees nothing at all.
    await victim.page.goto('/#/feed')
    await victim.page.waitForTimeout(3000)
    await expect(victim.page.getByText('hello from the e2e suite')).toHaveCount(0)
  } finally {
    await victim.ctx.close()
  }
})
