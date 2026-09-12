// node window-bounds-core.cjs test — plain asserts, mirrors admin-pin.test.cjs.
const assert = require('assert')
const { sanitizeBounds } = require('./window-bounds-core.cjs')

const workArea = { x: 0, y: 0, width: 1366, height: 768 }
assert.strictEqual(sanitizeBounds(null, workArea), null, 'null stays null')
assert.strictEqual(sanitizeBounds({ x: 5000, y: 5000, width: 1440, height: 900 }, workArea), null, 'off-screen bounds rejected')
assert.strictEqual(sanitizeBounds({ x: 100, y: 50, width: 640, height: 900 }, workArea), null, 'too-narrow bounds rejected')
const ok = sanitizeBounds({ x: 100, y: 50, width: 1200, height: 700 }, workArea)
assert.deepStrictEqual(ok, { x: 100, y: 50, width: 1200, height: 700 })
const clamped = sanitizeBounds({ x: 0, y: 0, width: 5000, height: 5000 }, workArea)
assert.ok(clamped.height <= 768 && clamped.width <= 1366, 'size clamped to work area')
assert.strictEqual(sanitizeBounds({ x: 'a', y: 0, width: 1000, height: 700 }, workArea), null, 'garbage x rejected')
console.log('window-bounds tests passed')
