// Standalone node test for dom-video-core.cjs (Electron main tests are not
// wired into vitest — run: node electron/dom-video-core.test.cjs).
const assert = require('node:assert')
const { clampDurationMs, validVideoUrl, windowGeometry, playerPageUrl } = require('./dom-video-core.cjs')

// duration clamps
assert.strictEqual(clampDurationMs(999_999_999), 15 * 60_000)
assert.strictEqual(clampDurationMs(1), 5000)
assert.strictEqual(clampDurationMs(undefined), 60_000)
assert.strictEqual(clampDurationMs('12'), 60_000)

// url gate: https only, bounded, no tricks
assert.strictEqual(validVideoUrl('https://x/v.mp4'), 'https://x/v.mp4')
assert.strictEqual(validVideoUrl('http://x/v.mp4'), null)
assert.strictEqual(validVideoUrl('file:///C:/v.mp4'), null)
assert.strictEqual(validVideoUrl('data:text/html,x'), null)
assert.strictEqual(validVideoUrl(`https://x/${'a'.repeat(3000)}`), null)
assert.strictEqual(validVideoUrl(42), null)

// geometry clamps to the work area
assert.deepStrictEqual(windowGeometry({ width: 1920, height: 1080 }), { width: 960, height: 540 })
const small = windowGeometry({ width: 800, height: 500 })
assert.ok(small.width <= 680 && small.height <= 425 && small.width >= 320 && small.height >= 180)

// player page: the url lands in the video tag, quotes escaped
const page = playerPageUrl('https://x/v.mp4?a=1&b=2')
assert.ok(page.startsWith('data:text/html;charset=utf-8,'))
const html = decodeURIComponent(page.replace('data:text/html;charset=utf-8,', ''))
assert.ok(html.includes('<video src="https://x/v.mp4?a=1%26b=2"'))
assert.ok(html.includes('window.close()'))
assert.ok(!/<script/.test(html), 'no script tags in the player page')

console.log('dom-video-core: all assertions passed')
