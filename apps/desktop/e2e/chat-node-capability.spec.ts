import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

// What happens when the node does NOT host the social lanes.
//
// The courier deployment is blind: it forwards sealed mail and 404s every
// stateful route (lobby, queue, invites). Chat used to assume those routes
// existed, so an invite click became a bare 404 toast and lobby history
// looked like an empty room.
//
// The E2E node is a FULL node, so the blind-courier answer is simulated: one
// route on ONE page is fulfilled with 404 — exactly the single answer the
// capability probe (utils/nodeCapabilities.ts) reads. The other client talks to
// the real node, which makes the contrast part of the assertion: same build,
// same node, different answer => different UI.
test.setTimeout(180_000)

let suite = 0
function peers() {
  suite += 1
  const run = `${Date.now().toString(36).slice(-4)}${suite}`
  return { alpha: `Chat Alpha ${run}`, bravo: `Chat Bravo ${run}` }
}

function playerRow(page: Page, name: string) {
  return page.getByTestId('chat-player-row').filter({ hasText: name })
}

function composer(page: Page) {
  return page.getByLabel('Write a message')
}

async function publishDisplayName(page: Page, name: string) {
  await page.evaluate(async (displayName: string) => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await mod.orbitFetch(
      '/api/users/profile',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      },
      ident,
    )
    if (!res.ok) throw new Error(`display name PATCH failed: ${res.status}`)
  }, name)
}

/**
 * First load + node-side name. Split from the directory assertion on purpose:
 * a peer's Users row is created by its FIRST signed request, so both clients
 * must have loaded before either can be seen by the other.
 */
async function load(page: Page, self: string) {
  await page.goto('/#/messages')
  await publishDisplayName(page, self)
}

async function expectPeerInDirectory(page: Page, peer: string) {
  await page.reload()
  await expect(playerRow(page, peer)).toBeVisible({ timeout: 60_000 })
}

test('a node that only relays mail disables invites and says why', async ({ browser }: { browser: Browser }) => {
  const { alpha: ALPHA, bravo: BRAVO } = peers()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const alpha = await ctxA.newPage()
  const bravo = await ctxB.newPage()
  try {
    await seedApp(alpha, { displayName: ALPHA })
    await seedApp(bravo, { displayName: BRAVO })

    // Alpha's node is "blind": the probe route 404s (as it does at the edge on
    // the courier). Registered before the first navigation because the probe
    // runs once, on mount.
    await alpha.route('**/api/lobby/invites', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }),
    )

    await load(alpha, ALPHA)
    await load(bravo, BRAVO)
    await expectPeerInDirectory(alpha, BRAVO)
    await expectPeerInDirectory(bravo, ALPHA)

    const inviteOnAlpha = playerRow(alpha, BRAVO).getByLabel(`Invite ${BRAVO} to a game`)
    await expect(inviteOnAlpha).toBeDisabled()
    // The button explains itself — no click, no 404 toast.
    await expect(inviteOnAlpha).toHaveAttribute('title', /only relays sealed mail/)

    // Direct messages never touch the node, so that action stays live. This is
    // the difference between gating a lane and breaking the feature.
    await expect(playerRow(alpha, BRAVO).getByLabel(`Message ${BRAVO}`)).toBeEnabled()

    // The node-hosted lane replaces its composer with the reason instead of
    // offering a box whose messages would go nowhere.
    await alpha.getByRole('button', { name: /Lobby Lounge/ }).click()
    await expect(alpha.getByText(/lobby, queue and group chat need a node that hosts them/)).toBeVisible({
      timeout: 20_000,
    })
    await expect(composer(alpha)).toHaveCount(0)

    // Same build, same node — only the probe answer differs. Bravo's node hosts
    // matches, so the invite action is offered.
    const inviteOnBravo = playerRow(bravo, ALPHA).getByLabel(`Invite ${ALPHA} to a game`)
    await expect(inviteOnBravo).toBeEnabled()
    await expect(inviteOnBravo).toHaveAttribute('title', `Invite ${ALPHA} to a game`)

    // A courier-hosted lane must not be confused with a courier-hosted DM: the
    // DM thread opens with a working composer on the blind node too.
    await playerRow(alpha, BRAVO).getByLabel(`Message ${BRAVO}`).click()
    await expect(composer(alpha)).toBeVisible({ timeout: 20_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
