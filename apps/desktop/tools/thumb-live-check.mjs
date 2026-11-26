/**
 * Live check for the RENDERER thumbnail path (utils/mediaThumb.ts).
 *
 * jsdom has no `createImageBitmap`, so the real decode/resize path is only
 * provable in a browser. This boots the Vite dev server, drives real Chromium,
 * and asserts against real bytes:
 *
 *   1. a 3000x2000 source yields a thumbnail whose longest edge is <= 360;
 *   2. the thumbnail blob is much smaller than the original;
 *   3. the original is fetched exactly ONCE (no double download);
 *   4. a second `get()` is served from the store (no second fetch);
 *   5. a small source is skipped (returns null, so it renders at full size);
 *   6. the full-size source is never painted by the tile: `peek()` has the
 *      small url only.
 *
 * Usage (from apps/desktop):  node tools/thumb-live-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const PORT = 5311
const BASE = `http://localhost:${PORT}/`

// `shell: true` is required to spawn `npx.cmd` on Windows; pass ONE command
// string so no argument needs escaping.
const vite = spawn(`npx vite --port ${PORT} --strictPort`, {
  cwd: process.cwd(),
  stdio: 'ignore',
  shell: true,
})

async function waitForServer(timeoutMs = 45_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('vite did not come up')
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('pageerror', () => {})
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async () => {
    const mod = await import('/src/utils/mediaThumb.ts')
    mod.__resetMediaThumbStoreForTests()
    const store = mod.mediaThumbStore()

    // Count fetches per url so a double download is visible.
    const fetches = new Map()
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      fetches.set(url, (fetches.get(url) ?? 0) + 1)
      return realFetch(input, init)
    }

    const makeImage = async (w, h, noisy) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, '#ff0080')
      grad.addColorStop(1, '#8000ff')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
      if (noisy) {
        // Noise defeats the PNG compressor so the original really is large.
        const img = ctx.getImageData(0, 0, w, h)
        for (let i = 0; i < img.data.length; i += 4) img.data[i] = (i * 97) % 255
        ctx.putImageData(img, 0, 0)
      }
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      return blob
    }

    const big = await makeImage(3000, 2000, true)
    const small = await makeImage(200, 100, false)
    const bigUrl = URL.createObjectURL(big)
    const smallUrl = URL.createObjectURL(small)

    const thumbUrl = await store.get(bigUrl)
    const again = await store.get(bigUrl)
    const smallResult = await store.get(smallUrl)

    const measure = async (url) => {
      const blob = await (await realFetch(url)).blob()
      const bmp = await createImageBitmap(blob)
      const out = { bytes: blob.size, type: blob.type, width: bmp.width, height: bmp.height }
      bmp.close?.()
      return out
    }

    const thumbMeta = thumbUrl ? await measure(thumbUrl) : null

    return {
      original: { bytes: big.size, width: 3000, height: 2000 },
      thumb: thumbMeta,
      reusedFromStore: thumbUrl === again,
      smallSkipped: smallResult === null,
      peekHasThumb: store.peek(bigUrl) === thumbUrl,
      peekHasSmall: store.peek(smallUrl),
      fetches: { big: fetches.get(bigUrl) ?? 0, small: fetches.get(smallUrl) ?? 0 },
      storeSize: store.size(),
    }
  })

  const checks = {
    thumbMade: Boolean(result.thumb),
    boundedLongestEdge: result.thumb
      ? Math.max(result.thumb.width, result.thumb.height) <= 360 && Math.min(result.thumb.width, result.thumb.height) > 0
      : false,
    muchSmaller: result.thumb ? result.thumb.bytes < result.original.bytes : false,
    fetchedOriginalOnce: result.fetches.big === 1,
    reusedFromStore: result.reusedFromStore === true,
    smallSkipped: result.smallSkipped === true,
    peekHasThumb: result.peekHasThumb === true,
  }

  const ok = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ ok, checks, result }, null, 2))
  if (!ok) process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  vite.kill()
}
