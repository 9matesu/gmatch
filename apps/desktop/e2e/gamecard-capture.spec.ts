// Visual evidence for the ONE premium TCG GameCard. The market/collection
// routes are mocked with a synthetic card so the capture is deterministic on a
// fresh hermetic node (a new account owns no cards by design). The card itself
// is the real GameCard component, opened through the real marketplace detail
// view — no stand-in markup.
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seedApp } from './helpers'

const OUT = fileURLToPath(new URL('../../../site/img/', import.meta.url))
mkdirSync(OUT, { recursive: true })
test.setTimeout(180_000)

const CARD_ID = 'card-capture-1'
const OBJECT_ID = 'obj-capture-1'
// Synthetic signed bytes: a faceted sigil, not a gM placeholder. The card
// itself is still the real GameCard — only the artwork is stand-in data.
const SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='700' viewBox='0 0 600 700'><defs><radialGradient id='bg' cx='50%' cy='42%' r='76%'><stop offset='0' stop-color='#1d2340'/><stop offset='0.55' stop-color='#0b1024'/><stop offset='1' stop-color='#05060c'/></radialGradient><linearGradient id='gold' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff1b8'/><stop offset='0.45' stop-color='#d9a441'/><stop offset='1' stop-color='#8a5a12'/></linearGradient><linearGradient id='ice' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#dffbff'/><stop offset='1' stop-color='#2b8fb3'/></linearGradient></defs><rect width='600' height='700' fill='url(#bg)'/><g stroke='#d9a441' stroke-opacity='0.22' stroke-width='2'><path d='M300 330 L300 40 M300 330 L120 120 M300 330 L480 120 M300 330 L60 330 M300 330 L540 330 M300 330 L110 540 M300 330 L490 540 M300 330 L300 620'/></g><circle cx='300' cy='330' r='205' fill='none' stroke='#9fd8e8' stroke-opacity='0.3' stroke-width='2'/><circle cx='300' cy='330' r='168' fill='none' stroke='#d9a441' stroke-opacity='0.38' stroke-width='1.5' stroke-dasharray='5 10'/><polygon points='300,120 405,245 300,500 195,245' fill='url(#ice)' fill-opacity='0.9'/><polygon points='300,120 300,500 195,245' fill='#0b1024' fill-opacity='0.35'/><polygon points='300,120 405,245 300,270' fill='url(#gold)' fill-opacity='0.92'/><polygon points='195,245 300,270 300,500' fill='#12314a' fill-opacity='0.85'/><polygon points='405,245 300,270 300,500' fill='#5fc8de' fill-opacity='0.45'/><polygon points='300,150 360,250 300,330 240,250' fill='url(#gold)' fill-opacity='0.5'/><circle cx='300' cy='330' r='30' fill='#05060c' fill-opacity='0.65'/><polygon points='300,296 334,330 300,364 266,330' fill='url(#gold)'/><g fill='#dffbff' fill-opacity='0.75'><circle cx='80' cy='90' r='2'/><circle cx='510' cy='110' r='2'/><circle cx='100' cy='470' r='1.5'/><circle cx='500' cy='500' r='2'/><circle cx='430' cy='70' r='1.5'/></g><path d='M180 600 H420' stroke='#d9a441' stroke-opacity='0.5' stroke-width='2'/></svg>"

const card = {
  id: CARD_ID,
  creatorId: 'creator-1',
  // The detail view renders GameCard from signed bytes (it does not pass
  // `contentUrl` as `src`), so back the synthetic object with real SVG bytes.
  mediaObjectId: OBJECT_ID,
  name: 'Neon Sovereign',
  tags: [],
  description: null,
  frame: 'holo',
  accentColor: '#a78bfa',
  rarity: 'gold',
  value: 5200,
  likeCount: 42,
  marketStatus: 'listed',
  moderationState: 'active',
  ownerId: 'me-1',
  ownerName: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  contentUrl: `data:image/svg+xml,${encodeURIComponent(SVG)}`,
  mimeType: 'image/svg+xml',
}

test('capture the TCG card detail', async ({ browser }) => {
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1366, height: 860 },
  })
  const page = await ctx.newPage()
  try {
    await seedApp(page)
    // Disjoint path patterns: no route-precedence bet between a wildcard and
    // the market path.
    await page.route(/\/api\/cards\/market(?:\?|$)/, (route) =>
      route.fulfill({
        json: {
          listings: [
            {
              listingId: 'l1',
              cardId: CARD_ID,
              price: 1200,
              sellerId: 'seller-1',
              sellerName: 'Ada',
              card,
            },
          ],
        },
      }),
    )
    await page.route(new RegExp(`/api/cards/${CARD_ID}(?:\\?|$)`), (route) =>
      route.fulfill({ json: { card: { ...card, listingPrice: 1200 } } }),
    )
    await page.route(/\/api\/cards(?:\?|$)/, (route) => route.fulfill({ json: { cards: [card] } }))
    await page.route(new RegExp(`/api/objects/${OBJECT_ID}(?:\\?|$)`), (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: SVG }),
    )

    await page.goto('/#/store')
    await expect(page.getByRole('heading', { name: 'Community Market' })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: `View card ${card.name}` }).click()
    await expect(page.getByRole('button', { name: 'Close card details' })).toBeVisible({ timeout: 30_000 })
    // The card's own hooks, not a timer: a blank marketplace OR an unresolved
    // art fetch would fail here. The HoloCard art must replace the woven back.
    // The market tile is also a GameCard (nameplate off); the detail card is
    // the one carrying the embossed plate.
    const gameCard = page.locator('[data-card]').filter({ has: page.locator('.tcg-title-plate') })
    await expect(gameCard).toBeVisible({ timeout: 30_000 })
    await expect(gameCard.locator('.tcg-title-plate')).toBeVisible()
    await expect(gameCard.locator('.tcg-stat-row')).toBeVisible()
    await expect(gameCard.locator('[data-card-art]')).toBeVisible({ timeout: 30_000 })
    await expect(gameCard.locator('.tcg-card-back')).toHaveCount(0)

    await page.screenshot({ path: `${OUT}gamecard.png` })
    console.log('captured site/img/gamecard.png')
  } finally {
    await ctx.close()
  }
})
