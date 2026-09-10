// node imageCacheMemory.test.cjs  — exits 1 on failure (repo has no CJS test
// runner for electron/; this mirrors the plain-node style of stage scripts).
const assert = require('assert')
const fs = require('fs')
const mem = require('./imageCacheMemory.cjs')

// put -> get verbatim
const buf = Buffer.from('hello-bytes', 'utf8')
mem.put('http://x/a.png', buf)
assert.deepStrictEqual(mem.get('http://x/a.png'), buf, 'round-trip verbatim')

// miss returns null
assert.strictEqual(mem.get('http://x/missing.png'), null, 'miss = null')

// eviction by byte budget, LRU order
mem.clear()
mem.setMaxBytes(100)
mem.put('k1', Buffer.alloc(40, 1))
mem.put('k2', Buffer.alloc(40, 2))
mem.get('k1') // touch k1 -> k2 becomes oldest
mem.put('k3', Buffer.alloc(40, 3)) // over budget -> evict LRU (k2)
assert.ok(mem.get('k1'), 'touched k1 survives')
assert.ok(mem.get('k3'), 'fresh k3 stored')
assert.strictEqual(mem.get('k2'), null, 'LRU k2 evicted')
assert.ok(mem.totalBytes() <= 100, `respect budget: ${mem.totalBytes()}`)

// oversized single entry is refused (no unbounded memory)
assert.strictEqual(mem.put('huge', Buffer.alloc(500, 9)), false, 'entry > budget refused')
assert.strictEqual(mem.get('huge'), null)

// clear() releases everything
mem.clear()
assert.strictEqual(mem.totalBytes(), 0)

// zero filesystem writes happened during put/get
// (the module never imports fs write paths; guard against future regressions
// by checking its source text contains no writeFileSync/mkdirSync.)
const src = fs.readFileSync(__filename.replace('.test.cjs', '.cjs'), 'utf8')
assert.ok(!/writeFileSync|mkdirSync|createWriteStream/.test(src), 'imageCacheMemory must not touch disk')

console.log('imageCacheMemory: all assertions passed')
