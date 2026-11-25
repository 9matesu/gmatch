// node stdio-guard.test.cjs — plain asserts, mirrors mainlog.test.cjs.
//
// The bug this pins: `console.log()` into a closed pipe does NOT throw at the
// call site — node emits an 'error' event on the stream. A try/catch around
// the call cannot catch it, and without a stream-level listener node kills
// the process ("Error: EPIPE: broken pipe, write"). The real app died this
// way (main.log: "uncaught: Error: EPIPE: broken pipe, write").
const assert = require('assert')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { guardStdio, guardStream } = require('./stdio-guard.cjs')

const guardPath = path.join(__dirname, 'stdio-guard.cjs')

/**
 * Run a child that writes to stdout AFTER the parent closed the read end.
 * Resolves { code, stderr }.
 *
 * TWO writes are needed on Windows: the first primes the pipe (and is
 * buffered), the second is the one that hits the closed reader and raises
 * the async 'error' event. With one write the child often exits before the
 * error is delivered.
 */
function writeIntoClosedPipe(childBody) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', childBody], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += String(d) })
    // The reader goes away -> the child's stdout pipe breaks.
    child.stdout.destroy()
    child.on('exit', (code) => resolve({ code, stderr }))
  })
}

const WRITE = `
  const line = 'x'.repeat(200)
  try { console.log(line) } catch { /* a synchronous throw cannot catch EPIPE */ }
  setTimeout(() => { console.log(line) }, 200)
`

async function main() {
  // 1. Without the guard the process dies with an unhandled 'error' event.
  const bare = await writeIntoClosedPipe(WRITE)
  assert.notStrictEqual(bare.code, 0, 'an unguarded broken pipe kills the process')
  assert.match(bare.stderr, /EPIPE/, 'the unguarded failure really is EPIPE')

  // 2. With the guard the same write is harmless.
  const guarded = await writeIntoClosedPipe(
    `require(${JSON.stringify(guardPath)}).guardStdio()\n${WRITE}`
  )
  assert.strictEqual(guarded.code, 0, `a guarded broken pipe is survivable (stderr: ${guarded.stderr})`)
  assert.doesNotMatch(guarded.stderr, /EPIPE/, 'no EPIPE escapes the guard')

  // 3. The guard is idempotent and works on a bare event emitter.
  let listeners = 0
  const fake = { on: (_ev, fn) => { listeners++; fake.fn = fn } }
  assert.strictEqual(guardStream(fake), true)
  assert.strictEqual(guardStream(fake), true)
  assert.strictEqual(listeners, 1, 'guarding twice must not stack listeners')

  // 4. A non-EPIPE error is still reported (the guard hides pipe noise only).
  const seen = []
  const fakeErr = {
    on: (_ev, fn) => { fakeErr.fn = fn },
  }
  guardStream(fakeErr)
  const origError = console.error
  console.error = (...args) => seen.push(args)
  try {
    fakeErr.fn({ code: 'EPIPE' })
    fakeErr.fn(new Error('real problem'))
  } finally {
    console.error = origError
  }
  assert.strictEqual(seen.length, 1, 'EPIPE is swallowed, other errors are reported')

  // 5. guardStdio guards BOTH streams.
  const made = []
  const fakeProc = {
    stdout: { on: () => { made.push('out') } },
    stderr: { on: () => { made.push('err') } },
  }
  assert.strictEqual(guardStdio(fakeProc), true)
  assert.deepStrictEqual(made.sort(), ['err', 'out'], 'stdout + stderr are both guarded')

  console.log('stdio-guard tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
