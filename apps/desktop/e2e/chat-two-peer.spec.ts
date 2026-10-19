import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

// Direct messages between two INDEPENDENT clients (separate browser contexts =
// separate identities, storage, keys and mail sockets) on one node.
//
// The courier lane is the only DM path on a current node (`/api/pm` is
// retired), so this spec exercises the real one: sealed envelope out, sealed
// envelope in, plus the event layer that rides it (ack -> Delivered, read
// watermark -> Seen, typing, reply, edit, react, delete-for-everyone).
//
// The acks and receipts are asserted as *states that differ*: a message that
// merely reached the peer must NOT read "Seen". That distinction is the whole
// point of the rewrite, so it is checked between two real clients.
test.setTimeout(300_000)

// Unique per TEST, not just per run: both tests drive one node database, so a
// shared name leaves test 1's identities matching test 2's directory lookups
// (Playwright then fails strict mode with two identical rows).
let suite = 0
function peers() {
  suite += 1
  const run = `${Date.now().toString(36).slice(-4)}${suite}`
  return { alpha: `Chat Alpha ${run}`, bravo: `Chat Bravo ${run}` }
}

const MSG_1 = 'alpha to bravo one'
const MSG_2 = 'bravo to alpha two'

function playerRow(page: Page, name: string) {
  return page.getByTestId('chat-player-row').filter({ hasText: name })
}

function composer(page: Page) {
  return page.getByLabel('Write a message')
}

/**
 * Give the identity a real name ON THE NODE, not just in localStorage: the
 * directory row the other client renders comes from /api/users, and a Users
 * row is created with a placeholder until the profile is written (the same
 * call onboarding makes).
 */
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

async function waitForPeer(page: Page, name: string) {
  await expect(playerRow(page, name)).toBeVisible({ timeout: 60_000 })
}

/** Open the DM thread with `name` from the directory's row action. */
async function openDmWith(page: Page, name: string) {
  await playerRow(page, name).getByLabel(`Message ${name}`).click()
  await expect(composer(page)).toBeVisible({ timeout: 20_000 })
}

/**
 * A message's whole ROW. `data-message-id` sits on the bubble alone, while the
 * timestamp, the Delivered/Seen mark, "not delivered" and the reaction chips
 * are siblings of it — so receipt assertions must scope to the row, not the
 * bubble.
 */
function messageRow(page: Page, text: string) {
  return page.locator('[data-message-row]', { hasText: text }).first()
}

/** The clickable bubble (clicking it opens that message's action menu). */
function bubble(page: Page, text: string) {
  return page.locator('[data-message-id]', { hasText: text }).first()
}

async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(bubble(page, text)).toBeVisible({ timeout: 20_000 })
}

test('sealed DMs cross two independent clients with honest receipts', async ({ browser }: { browser: Browser }) => {
  const { alpha: ALPHA, bravo: BRAVO } = peers()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const alpha = await ctxA.newPage()
  const bravo = await ctxB.newPage()
  try {
    await seedApp(alpha, { displayName: ALPHA })
    await seedApp(bravo, { displayName: BRAVO })

    // Both register with the node (the Users row is a side effect of the first
    // signed request), take a real name, then each sees the other in its
    // directory. The reload makes the name visible on the FIRST users fetch
    // instead of whenever the poll next fires.
    await alpha.goto('/#/messages')
    await bravo.goto('/#/messages')
    await publishDisplayName(alpha, ALPHA)
    await publishDisplayName(bravo, BRAVO)
    await alpha.reload()
    await bravo.reload()
    await waitForPeer(alpha, BRAVO)
    await waitForPeer(bravo, ALPHA)

    // ── Send ────────────────────────────────────────────────────────────────
    await openDmWith(alpha, BRAVO)
    await send(alpha, MSG_1)

    // ── Arrival, and Delivered ≠ Seen ───────────────────────────────────────
    // Bravo has the thread listed (the envelope arrived and was opened) but has
    // NOT opened the conversation. Alpha must therefore see "Delivered" and
    // must not see "Seen" — a delivery ack is not a read receipt.
    await expect(bravo.getByText(MSG_1).first()).toBeVisible({ timeout: 60_000 })
    await expect(messageRow(alpha, MSG_1).locator('[title="Delivered"]')).toBeVisible({ timeout: 30_000 })
    await expect(messageRow(alpha, MSG_1).locator('[title="Seen"]')).toHaveCount(0)
    // And the unread badge counts it locally (no server can count sealed DMs).
    await expect(bravo.locator('[title="1 unread"]')).toBeVisible({ timeout: 20_000 })

    // ── Open the thread: now "Seen" is earned ───────────────────────────────
    await bravo
      .getByRole('button')
      .filter({ hasText: MSG_1 })
      .first()
      .click()
    await expect(bubble(bravo, MSG_1)).toBeVisible({ timeout: 20_000 })
    await expect(messageRow(alpha, MSG_1).locator('[title="Seen"]')).toBeVisible({ timeout: 30_000 })
    // The unread badge is cleared by the same act, locally.
    await expect(bravo.locator('[title="1 unread"]')).toHaveCount(0)

    // ── Typing (transient, throttled, never persisted) ──────────────────────
    await composer(bravo).fill('mid-sentence')
    await expect(alpha.getByText('typing…')).toBeVisible({ timeout: 30_000 })

    // ── Reply crosses with its quoted context ───────────────────────────────
    await bubble(bravo, MSG_1).click()
    await bravo.getByRole('button', { name: 'Reply', exact: true }).click()
    await send(bravo, MSG_2)
    await expect(bubble(alpha, MSG_2)).toBeVisible({ timeout: 30_000 })
    // Alpha sees the quote as its own message ("You: ...").
    await expect(alpha.getByText(`You: ${MSG_1}`).first()).toBeVisible({ timeout: 20_000 })
    // Bravo sees it attributed to the other side.
    await expect(bravo.getByText(`${ALPHA}: ${MSG_1}`).first()).toBeVisible({ timeout: 20_000 })

    // ── Edit is author-only and propagates ─────────────────────────────────
    // Scope to the message ROW (the sidebar and the header also have
    // `input[type="text"]` search boxes — filling the first one silently
    // filtered the conversation instead of editing).
    const editedRow = alpha.locator(`[data-message-row="${await bubble(alpha, MSG_1).evaluate((el) => el.closest('[data-message-row]')?.getAttribute('data-message-row') ?? '')}"]`)
    await bubble(alpha, MSG_1).click()
    await alpha.getByRole('button', { name: 'Edit', exact: true }).click()
    await editedRow.getByRole('textbox').fill('alpha to bravo one (fixed)')
    await editedRow.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(bubble(bravo, 'alpha to bravo one (fixed)')).toBeVisible({ timeout: 30_000 })
    await expect(bravo.getByText('Edited').first()).toBeVisible({ timeout: 20_000 })

    // ── Reaction crosses and aggregates per actor ───────────────────────────
    await bubble(bravo, MSG_2).click()
    await bravo.getByRole('button', { name: 'React with 🔥' }).click()
    // Alpha sees a chip carrying the reaction (Bravo's, so not "mine"): the
    // chip's title is the count, and its own menu offer is to ADD one.
    await expect(messageRow(alpha, MSG_2).locator('[title="1 reaction"]')).toBeVisible({ timeout: 30_000 })
    await expect(messageRow(alpha, MSG_2).getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'false')

    // ── Delete for everyone leaves a tombstone on both sides ────────────────
    await bubble(bravo, MSG_2).click()
    await bravo.getByRole('button', { name: 'Delete for Everyone' }).click()
    await expect(alpha.getByText('Message deleted').first()).toBeVisible({ timeout: 30_000 })
    await expect(alpha.locator('[data-message-id]', { hasText: MSG_2 })).toHaveCount(0)

    // ── Reload keeps the local history and the receipts ────────────────────
    await alpha.reload()
    await expect(alpha.getByText('alpha to bravo one (fixed)').first()).toBeVisible({ timeout: 60_000 })
    await expect(alpha.getByText('Message deleted').first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})

test('an undeliverable DM says so instead of pretending', async ({ browser }: { browser: Browser }) => {
  const { alpha: ALPHA, bravo: BRAVO } = peers()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const alpha = await ctxA.newPage()
  const bravo = await ctxB.newPage()
  try {
    await seedApp(alpha, { displayName: ALPHA })
    await seedApp(bravo, { displayName: BRAVO })
    await alpha.goto('/#/messages')
    await bravo.goto('/#/messages')
    await publishDisplayName(alpha, ALPHA)
    await publishDisplayName(bravo, BRAVO)
    await alpha.reload()
    await bravo.reload()
    await waitForPeer(alpha, BRAVO)
    await waitForPeer(bravo, ALPHA)

    // Cut the seal path AFTER the directory loaded (keys are registered from
    // it), so the peer IS addressable and the failure is transport, not "no
    // key" — the honest-failure branch.
    await alpha.route('**/api/mail/**', (route) => route.abort('failed'))

    await openDmWith(alpha, BRAVO)
    await send(alpha, 'this one cannot leave')
    // The failure is stated, and it is stated on THAT message (the indicator
    // lives in the message row, next to the timestamp).
    await expect(alpha.getByText('not delivered')).toBeVisible({ timeout: 30_000 })
    await expect(messageRow(alpha, 'this one cannot leave').locator('[title="Not delivered"]')).toBeVisible({ timeout: 10_000 })
    // Nothing invented on the other side.
    await expect(bravo.getByText('this one cannot leave')).toHaveCount(0)
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
