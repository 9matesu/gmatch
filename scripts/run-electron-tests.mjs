// Runs every apps/desktop/electron/*.test.cjs with plain node (they are standalone
// scripts, not vitest files) and fails if any of them does.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const dir = resolve('apps/desktop/electron')
const files = readdirSync(dir).filter((f) => f.endsWith('.test.cjs')).sort()
const failed = []
let passed = 0

for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], {
    cwd: resolve('apps/desktop'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (r.status === 0) {
    passed++
    console.log('ok  ', f)
  } else {
    failed.push(f)
    console.log('FAIL', f, '(exit', r.status ?? r.signal, ')')
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).join('\n')
    if (tail) console.log(tail.replace(/^/gm, '    '))
  }
}

console.log(`\nelectron tests: ${passed}/${files.length} passed`)
if (failed.length) {
  console.log('failed:', failed.join(', '))
  process.exit(1)
}