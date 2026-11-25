// node blocklist-ban.test.cjs — the durable ban write (plain asserts).
//
// A ban in the clicker ("never show yaoi again") must land in the user's
// blocklist.json, and it must MERGE into the authoritative list: the renderer
// only sends the TERMS, so a list main wrote since the renderer last read it
// survives.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocklistban-'))
const userFile = path.join(dir, 'blocklist.json')

const DEFAULTS = { blocklist: ['loli'], suggested: [], noise: [] }

// Fake ipcMain: capture the handlers.
const handlers = new Map()
const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) }
const app = { getPath: () => dir, getVersion: () => '0.0.0' }

let current = { ...DEFAULTS, blocklist: [...DEFAULTS.blocklist] }
const registerAppHandlers = require('./ipc/app.cjs')
registerAppHandlers({
  ipcMain,
  app,
  blocklist: {
    userPath: () => userFile,
    get: () => current,
    // Mirrors loadBlocklistData(): the user file wins, else the factory default.
    load: () => {
      if (fs.existsSync(userFile)) {
        const parsed = JSON.parse(fs.readFileSync(userFile, 'utf8'))
        if (parsed && Array.isArray(parsed.blocklist)) current = parsed
      } else {
        current = { ...DEFAULTS, blocklist: [...DEFAULTS.blocklist] }
      }
      return current
    },
    defaults: () => ({ ...DEFAULTS, blocklist: [...DEFAULTS.blocklist] }),
    apply: (d) => { current = d },
  },
})

const ban = handlers.get('blocklist:ban')
assert.ok(ban, 'blocklist:ban is registered')

// 1. The term lands in the user's file.
let res = ban(null, ['yaoi'])
assert.strictEqual(res.ok, true, 'the ban succeeded')
assert.ok(res.added.includes('yaoi'), 'the term is reported as added')
assert.ok(res.data.blocklist.includes('yaoi'), 'the returned list carries the term')
assert.ok(
  JSON.parse(fs.readFileSync(userFile, 'utf8')).blocklist.includes('yaoi'),
  'the term is in the user blocklist.json',
)

// 2. The merge is READ-MODIFY-WRITE on the AUTHORITATIVE list: a term written
//    to the file by someone else survives the ban (the old renderer-side
//    read-modify-write clobbered it).
fs.writeFileSync(
  userFile,
  JSON.stringify({ blocklist: ['loli', 'written_by_hand'], suggested: [], noise: [] }),
)
res = ban(null, 'solo')
assert.ok(res.data.blocklist.includes('written_by_hand'), 'the ban does not clobber a newer list')
assert.ok(res.data.blocklist.includes('solo'), 'the ban landed')
assert.ok(
  JSON.parse(fs.readFileSync(userFile, 'utf8')).blocklist.includes('written_by_hand'),
  'the file kept the newer term',
)

// 3. A duplicate is a no-op (no second copy).
res = ban(null, ['solo'])
assert.deepStrictEqual(res.added, [], 'a duplicate adds nothing')
assert.strictEqual(
  JSON.parse(fs.readFileSync(userFile, 'utf8')).blocklist.filter((t) => t === 'solo').length,
  1,
  'the term is not duplicated in the file',
)

// 4. The term is lowercased + trimmed.
res = ban(null, ['  YAOI  '])
assert.ok(res.added.includes('yaoi'), 'the term is normalized')
assert.ok(!res.added.includes('  YAOI  '), 'the raw term is not stored')

// 5. A garbage payload is refused, not written.
const before = fs.readFileSync(userFile, 'utf8')
res = ban(null, { tag: 123 })
assert.strictEqual(res.ok, true, 'a non-string term is ignored, not fatal')
assert.ok(!res.added.includes('123'), 'a number is not a tag')
assert.strictEqual(fs.readFileSync(userFile, 'utf8'), before, 'the file is untouched')

console.log('blocklist-ban tests passed')
