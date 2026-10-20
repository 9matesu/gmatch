import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { seedApp } from './helpers'

// Strict local-only keepsakes: a saved Clicker image/video must open from
// verified local bytes, never the provider URL — including in a new window,
// including with the provider unreachable, including for large MP4s.

test.use({ contextOptions: { serviceWorkers: 'block' } })
test.setTimeout(240_000)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
// Synthetic MP4 payload sized to exercise the chunked path well past any
// image-oriented byte ceiling (32MB). Codec validity is irrelevant here:
// persistence asserts bytes+hash, playback asserts the PNG.
const MP4_BYTES = 32 * 1024 * 1024

let stub: Server
let stubBase = ''
const stubHits: string[] = []

test.beforeAll(async () => {
  const big = Buffer.alloc(MP4_BYTES, 0xab)
  stub = createServer((req, res) => {
    stubHits.push(`${req.method} ${req.url}`)
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    if (req.url === '/pic.png') {
      res.writeHead(200, { ...headers, 'Content-Type': 'image/png', 'Content-Length': PNG.length })
      res.end(PNG)
      return
    }
    if (req.url === '/clip.mp4') {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      if (range) {
        const start = range[1] ? parseInt(range[1], 10) : 0
        const end = range[2] ? Math.min(parseInt(range[2], 10), big.length - 1) : big.length - 1
        res.writeHead(206, {
          ...headers,
          'Content-Type': 'video/mp4',
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${big.length}`,
        })
        res.end(big.subarray(start, end + 1))
        return
      }
      res.writeHead(200, { ...headers, 'Content-Type': 'video/mp4', 'Content-Length': big.length })
      res.end(big)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const addr = stub.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  stubBase = `http://127.0.0.1:${port}`
})

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve))
})

async function persistInPage(page: Page, url: string, kind: 'image' | 'video') {
  return page.evaluate(
    async ({ u, k }) => {
      const m = await import('/src/services/keepsake.ts')
      return m.persistKeepsake(u, {}, k)
    },
    { u: url, k: kind },
  )
}

async function localBytes(page: Page, key: string): Promise<number> {
  return page.evaluate(async (k) => {
    const m = await import('/src/utils/p2pSwarm.ts')
    const b = await m.getLocalObject(k)
    return b ? b.size : -1
  }, key)
}

async function dismissOverlays(page: Page) {
  // Changelog/offline-earnings modals appear after reload; clear them.
  for (let i = 0; i < 5; i++) {
    const btn = page.locator('[role="dialog"] button, .fixed.inset-0 button').first()
    if ((await btn.count()) === 0) return
    await btn.click({ timeout: 3_000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
}

test('saved image opens from local bytes; provider outage changes nothing', async ({ page }) => {
  await seedApp(page)
  // No changelog pin here on purpose: `seedApp` already stamps
  // `gmatch_last_seen_changelog` with `E2E_CHANGELOG_VERSION`, and a hardcoded
  // version in this file goes stale the moment a release ships (it was pinned
  // to 1.5.5 for an app that had moved on), letting the What's New modal
  // swallow every click after reload.
  //
  // The keepsake merge re-runs on EVERY navigation (seedApp re-seeds
  // gallery:[] each load), so reloads keep the records while IDB keeps bytes.
  await page.addInitScript((stub: string) => {
    const keeps = [
      {
        id: 'e2e-keep-img', url: `${stub}/pic.png`, tags: ['e2e-img'], rarityBase: 1, clicks: 1,
        rarity: 'Common', boughtAt: Date.now(), kind: 'image', localStatus: 'local',
      },
      {
        id: 'e2e-keep-vid', url: `${stub}/clip.mp4`, tags: ['e2e'], rarityBase: 1, clicks: 1,
        rarity: 'Common', boughtAt: Date.now(), kind: 'video', localStatus: 'local',
      },
    ]
    const idRaw = localStorage.getItem('orbit_identity')
    const orbitId = idRaw ? (JSON.parse(idRaw) as { orbitId: string }).orbitId : ''
    for (const key of ['gmatch.save.v1', orbitId ? `gmatch.save.v1:${orbitId}` : '']) {
      if (!key) continue
      const raw = localStorage.getItem(key)
      const save = raw ? JSON.parse(raw) : { version: 3 }
      const have = new Set(((save.gallery || []) as { id: string }[]).map((g) => g.id))
      save.gallery = [...(save.gallery || []), ...keeps.filter((k) => !have.has(k.id))]
      localStorage.setItem(key, JSON.stringify(save))
    }
  }, stubBase)
  const picUrl = `${stubBase}/pic.png`
  const clipUrl = `${stubBase}/clip.mp4`

  // 1. Save through the real pipeline (fetch -> validate -> hash -> IDB).
  await page.goto('/#/grid');
  const saved = await persistInPage(page, picUrl, 'image')
  expect(saved.status).toBe('local')
  // `ref` IS the content identity (sha256 of the stored bytes) — the field the
  // pipeline returns; it was renamed from `hash` when localRef became the
  // single local identity.
  expect(saved.ref).toMatch(/^[0-9a-f]{64}$/)
  expect(await localBytes(page, picUrl)).toBeGreaterThan(0)

  // 2. MP4 (32MB) persists whole-file in dev (no image-oriented cutoff).
  const savedClip = await persistInPage(page, clipUrl, 'video')
  expect(savedClip.status).toBe('local')
  expect(savedClip.ref).toMatch(/^[0-9a-f]{64}$/)
  expect(await localBytes(page, clipUrl)).toBe(MP4_BYTES)

  // Bytes via the real pipeline (records come from the init script above).
  await page.goto('/#/grid')
  await persistInPage(page, picUrl, 'image')
  await persistInPage(page, clipUrl, 'video')

  // 4. Kill the provider, RELOAD (save + IDB survive), open the gallery.
  stubHits.length = 0
  await page.route(`${stubBase}/**`, (route) => route.abort('failed'))
  await page.reload()
  await page.goto('/#/grid')
  // Modals (changelog/offline-earnings) can pop after load and swallow
  // clicks: retry the drawer open with dismissals between attempts.
  const drawerBtn = page.getByRole('button', { name: /Keepsakes Gallery/i })
  let opened = false
  for (let i = 0; i < 10 && !opened; i++) {
    await dismissOverlays(page)
    try {
      await drawerBtn.click({ timeout: 5_000 })
      opened = true
    } catch {
      await page.waitForTimeout(1000)
    }
  }
  expect(opened).toBe(true)
  const tile = page.getByRole('button', { name: /^View e2e-img/i })
  await expect(tile).toBeVisible({ timeout: 30_000 })
  // Local blob resolution is async: wait until the tile serves local bytes
  // (blob:/vault:/gmcache:, never the provider host).
  const stubHost = new URL(stubBase).host
  await page.waitForFunction(
    (host) => {
      const el = document.querySelector('[data-keepsake-id]') as HTMLImageElement | HTMLVideoElement | null
      const src = (el as HTMLImageElement)?.currentSrc || (el as HTMLVideoElement)?.currentSrc || el?.getAttribute('src') || ''
      return /^(blob:|vault:|gmcache:|idle-file:|data:)/.test(src) && !src.includes(host)
    },
    stubHost,
    { timeout: 30_000 },
  )
  const renderedSrc = await page.evaluate(() => {
    const img = document.querySelector('#gallery-panel-cards img, [data-keepsake-id]') as HTMLImageElement | null
    return img ? img.currentSrc || img.src : null
  })
  expect(renderedSrc).toBeTruthy()
  expect(renderedSrc).not.toContain(new URL(stubBase).host)
  expect(stubHits.filter((h) => h.includes('/pic.png') || h.includes('/clip.mp4'))).toHaveLength(0)

  // 5. New window opens local bytes, never the provider URL.
  // window.open is stubbed to record (not navigate): the assertion is on the
  // navigation TARGET's origin — blob:/localhost only, never the provider.
  await page.evaluate(() => {
    const w = window as unknown as { __opened?: (string | null)[] };
    w.__opened = [];
    window.open = ((url?: string | null) => {
      w.__opened!.push(url ?? null);
      return null;
    }) as typeof window.open;
  });
  await tile.click()
  // Scope to the keepsake viewer dialog: other surfaces have their own
  // Browser buttons, and only this viewer's handler is under test.
  const viewerDialog = page.getByRole('dialog', { name: /Keepsake viewer/i })
  await expect(viewerDialog).toBeVisible({ timeout: 30_000 })
  const viewerMedia = await viewerDialog.evaluate((dlg) => {
    const img = dlg.querySelector('img') as HTMLImageElement | null
    const vid = dlg.querySelector('video') as HTMLVideoElement | null
    const err = dlg.querySelector('[role="alert"]')
    return {
      imgSrc: img ? img.currentSrc || img.src : null,
      vidSrc: vid ? vid.currentSrc || vid.src : null,
      showsError: !!err,
      errorText: err ? (err.textContent || '').slice(0, 120) : null,
    }
  })
  console.log('VIEWER:', JSON.stringify(viewerMedia))
  const browserBtn = viewerDialog.getByRole('button', { name: /^Browser$/i })
  await expect(browserBtn).toBeEnabled({ timeout: 60_000 })
  // The viewer resolves bytes async too: retry the open until recorded.
  let openedTargets: (string | null)[] = []
  for (let i = 0; i < 5 && openedTargets.length === 0; i++) {
    await browserBtn.click()
    await page.waitForTimeout(1000)
    openedTargets = await page.evaluate(() => {
      const w = window as unknown as { __opened?: (string | null)[] };
      return w.__opened || [];
    })
  }
  expect(openedTargets.length).toBeGreaterThan(0);
  console.log('OPENED:', JSON.stringify(openedTargets))
  for (const target of openedTargets) {
    expect(target).toBeTruthy();
    expect(target).not.toContain(new URL(stubBase).host);
    expect(target).toMatch(/^(blob:|http:\/\/localhost|http:\/\/127\.0\.0\.1)/);
  }

  // 6. Legacy remote-only keepsake: error state, no external navigation.
  // Close the current viewer first (it intercepts pointer events).
  await viewerDialog.getByRole('button', { name: /Close viewer/i }).click()
  await expect(viewerDialog).toBeHidden({ timeout: 15_000 })
  await page.evaluate(async () => {
    const store = await import('/src/game/store.ts')
    store.useGame.setState((s) => ({
      gallery: [
        ...s.gallery,
        {
          id: 'e2e-legacy', url: 'https://provider.invalid/gone.jpg', tags: ['e2e-legacy'],
          rarityBase: 1, clicks: 1, rarity: 'Common', boughtAt: Date.now(), kind: 'image',
        },
      ],
    }))
  })
  const legacyTile = page.getByRole('button', { name: /^View e2e-legacy/i })
  await legacyTile.click()
  await expect(page.getByText(/unavailable locally/i)).toBeVisible({ timeout: 30_000 })
  expect(page.url()).toContain('/#/grid')
})
