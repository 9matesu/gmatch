'use strict'
// node booru-rating.test.cjs — exits 1 on failure (plain-node style, no runner).
//
// The main process is the renderer's defence in depth: it re-filters booru
// responses before they cross the IPC boundary. It was not actually filtering
// on rating, because every parser hardcoded `rating: 'e'` — so the check
// approved posts whose rating no source had ever reported. The booru.org parser
// was worse still: it accepted `questionable` and returned `'e'`, promoting a
// questionable post straight through the 18+ gate.
//
// These are source-text assertions because main.cjs is a side-effectful module
// with no export seam (same approach as vault-scheme.test.cjs). They assert the
// specific lines that made the gate a tautology are gone.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const lines = src.split(/\r?\n/)

/**
 * Lines matching a pattern, with numbers, for readable failure output.
 *
 * Comments are stripped first: the code below deliberately quotes the old
 * `rating: 'e'` in its own comments, and a grep-style assertion would match the
 * explanation instead of the defect.
 */
const hits = (re) => lines
  .map((l, i) => ({ n: i + 1, l: l.replace(/\/\/.*$/, '') }))
  .filter((x) => re.test(x.l))

// 1. No parser may invent an explicit rating.
const invented = hits(/rating:\s*'e'/)
assert.strictEqual(
  invented.length, 0,
  'no parser may hardcode rating "e" — that is what made the gate a tautology:\n' +
  invented.map((x) => `  ${x.n}: ${x.l.trim()}`).join('\n'),
)

// 2. No `? 'e'` / `|| 'e'` / `?? 'e'` rating default.
const defaulted = hits(/rating[^,\n]*(\?\?|\|\|)\s*'e'/)
assert.strictEqual(
  defaulted.length, 0,
  'a missing rating must stay unknown, not default to explicit:\n' +
  defaulted.map((x) => `  ${x.n}: ${x.l.trim()}`).join('\n'),
)

// 3. booru.org must not promote questionable to explicit.
const promote = hits(/rating === 'questionable'/)
assert.strictEqual(
  promote.length, 0,
  'questionable posts must be dropped, not relabelled explicit:\n' +
  promote.map((x) => `  ${x.n}: ${x.l.trim()}`).join('\n'),
)

// 4. The dapi rating default must read undefined, not 'e'.
const dapi = hits(/rating: typeof p\.rating === 'string'/)
assert.ok(
  dapi.length >= 1,
  'expected the dapi parser to state how it derives a rating',
)
assert.ok(
  /: undefined/.test(dapi[0].l),
  `the dapi parser must pass through what the source said:\n  ${dapi[0].n}: ${dapi[0].l.trim()}`,
)

// 5. The explicit allowlist must remain, or nothing is filtered at all.
assert.ok(
  /p\.rating === 'explicit'/.test(src),
  'the explicit allowlist check must still exist',
)

console.log('booru-rating: assertion passed')
