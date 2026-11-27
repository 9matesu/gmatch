/**
 * UI token guard — no raw design values in the renderer source.
 *
 * Scans every .ts/.tsx under apps/desktop/src (tests are fixtures, and
 * globals.css is the @theme token definition itself, so both are excluded)
 * for the smells a common UI surface must never re-inline:
 *
 *   #hex · rgb()/rgba() · text-gray-* (unnamed palette) · p-[13px] (raw
 *   length) · style={{ padding: <number> }}
 *
 * Known game-semantic exceptions live in check-ui-tokens.allowlist.json,
 * keyed by file + smell + EXACT value: reusing an allowlisted value is fine,
 * but a NEW raw value in the same file still fails the gate.
 *
 *   node scripts/check-ui-tokens.mjs        # exit 0 clean, 1 on violations
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(desktop, 'src')
const allowlistPath = join(desktop, 'scripts', 'check-ui-tokens.allowlist.json')

const PATTERNS = [
  { id: 'hex-color', label: 'raw hex colour', re: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'raw-rgb', label: 'raw rgb()/rgba() colour', re: /\brgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)/g },
  { id: 'palette-text', label: 'unnamed palette text class', re: /\btext-(?:gray|slate|zinc|neutral|stone)-[a-z0-9-]+/g },
  { id: 'arbitrary-padding', label: 'raw-length padding utility', re: /\bp(?:[xytblr]?)-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g },
  {
    id: 'inline-numeric-padding',
    label: 'numeric padding in an inline style',
    re: /style\s*=\s*\{\{([\s\S]*?)\}\}/g,
    extract(match) {
      const inner = match[1]
      const found = inner.match(/\bpadding(?:Left|Right|Top|Bottom|Inline|Block|Horizontal|Vertical)?\s*:\s*(?:\{\s*)?-?\d+(?:\.\d+)?(?:px|em|rem)?/)
      if (!found) return null
      return { value: found[0].replace(/\s+/g, ' '), offset: match.index + match[0].indexOf(found[0]) }
    },
  },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

function rel(path) {
  return relative(srcDir, path).replace(/\\/g, '/')
}

function lineAt(text, offset) {
  let line = 1
  for (let i = 0; i < offset; i += 1) if (text[i] === '\n') line += 1
  return line
}

function isCommentLine(text, offset) {
  const start = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const end = text.indexOf('\n', offset)
  const line = text.slice(start, end < 0 ? undefined : end).trim()
  return line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')
}

function loadAllowlist() {
  const data = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  const known = new Set(PATTERNS.map((p) => p.id))
  const keys = new Set()
  for (const entry of data.entries ?? []) {
    if (typeof entry.file !== 'string' || typeof entry.why !== 'string') {
      throw new Error('allowlist entry needs a file and a why')
    }
    for (const [smell, values] of Object.entries(entry.smells ?? {})) {
      if (!known.has(smell)) throw new Error(`unknown smell "${smell}" in allowlist entry ${entry.file}`)
      for (const value of values) keys.add(`${entry.file}|${smell}|${value}`)
    }
  }
  return keys
}

const allowed = loadAllowlist()
const seenAllowed = new Set()
const violations = []
const files = walk(srcDir)

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const path = rel(file)
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.re)) {
      const extracted = pattern.extract ? pattern.extract(match) : { value: match[0], offset: match.index }
      if (!extracted) continue
      const line = lineAt(text, extracted.offset)
      if (isCommentLine(text, extracted.offset)) continue
      const key = `${path}|${pattern.id}|${extracted.value}`
      if (allowed.has(key)) {
        seenAllowed.add(key)
        continue
      }
      const start = Math.max(0, text.lastIndexOf('\n', Math.max(0, extracted.offset - 1)) + 1)
      const end = text.indexOf('\n', extracted.offset)
      violations.push({
        path, line, smell: pattern.id, value: extracted.value,
        snippet: text.slice(start, end < 0 ? undefined : end).trim().slice(0, 160),
      })
    }
  }
}

const stale = [...allowed].filter((key) => !seenAllowed.has(key))
if (stale.length) {
  console.log(`UI token guard: ${stale.length} stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} (no longer matched):`)
  for (const key of stale) console.log(`  ${key}`)
}

if (violations.length) {
  console.error(`UI token guard: FAIL — ${violations.length} raw-value smell(s) in ${files.length} files:`)
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line} ${v.smell} ${JSON.stringify(v.value)}`)
    console.error(`      ${v.snippet}`)
  }
  console.error(`\nUse a token from src/ui/tokens.ts; game semantics go in check-ui-tokens.allowlist.json with a reason.`)
  process.exit(1)
}

console.log(`UI token guard: OK — ${files.length} files scanned, ${seenAllowed.size} allowlisted game-semantic values, 0 violations.`)
