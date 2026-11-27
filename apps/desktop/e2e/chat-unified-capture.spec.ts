// Visual evidence for the UNIFIED chat surface. The old site/img/chat-unified.png
// was the boot splash (a capture that never navigated), so this spec drives the
// real sealed-DM lane between two independent identities and shoots the open
// thread. No fabricated bubbles: the message crosses the node's mail relay.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seedApp } from './helpers'

const OUT = fileURLToPath(new URL('../../../site/img/', import.meta.url))
mkdirSync(OUT, { recursive: true })
test.setTimeout(180_000)

const TEXT = 'The sealed lane is working.'
const run = Date.now().toString(36).slice(-5)
const ALPHA = `Capture Alpha ${run}`
const BRAVO = `Capture Bravo ${run}`

function playerRow(page: Page, name: string) {
  return page.getByTestId('chat-player-row').filter({ hasText: name })
}

function bubble(page: Page, text: string) {
  return page.locator('[data-message-id]', { hasText: text }).first()
}

/** Register the name on the NODE, not just in localStorage: the directory row
 *  the other client clicks comes from /api/users. Same retry as the chat
 *  journeys — a self-heal reload can destroy an in-flight evaluate. */
async function publishDisplayName(page: Page, name: string) {
  await expect
    .poll(
      async () => {
        try {
          await page.evaluate(async (displayName: string) => {
            const mod = await import('/src/utils/api.ts')
            const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
            const res = await mod.orbitFetch(
              '/api/users/profile',
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: displayName }),
              },
              identity,
            )
            if (!res.ok) throw new Error(`display name PATCH failed: ${res.status}`)
          }, name)
          return true
        } catch (err) {
          const message = String((err as Error)?.message ?? err)
          if (/Execution context was destroyed|Target closed|frame was detached|navigation/i.test(message)) {
            return false
          }
          throw err
        }
      },
      { timeout: 30_000, message: `could not publish display name ${name}` },
    )
    .toBe(true)
}

test('capture the unified chat thread', async ({ browser }) => {
  const ctxA = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1366, height: 860 },
  })
  const ctxB = await browser.newContext({ serviceWorkers: 'block' })
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
    await expect(playerRow(alpha, BRAVO)).toBeVisible({ timeout: 60_000 })

    await playerRow(alpha, BRAVO).getByLabel(`Message ${BRAVO}`).click()
    const composer = alpha.getByLabel('Write a message')
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.fill(TEXT)
    await composer.press('Enter')
    // Gate on the real bubble, never on a timeout: a splash would pass a timer.
    await expect(bubble(alpha, TEXT)).toBeVisible({ timeout: 30_000 })

    await alpha.screenshot({ path: `${OUT}chat-unified.png` })
    console.log('captured site/img/chat-unified.png')
  } finally {
    await ctxA.close()
    await ctxB.close()
  }
})
