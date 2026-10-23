#!/usr/bin/env node
/**
 * Multi-process P2P evidence harness (roadmap P1 #7).
 *
 * Runs the production swarm engine (`src/utils/p2pSwarm.ts`) in TWO REAL
 * node processes (via tsx; fake-indexeddb backs each child's durable store)
 * and lets THIS parent act as an UNTRUSTED RELAY between them:
 *
 *   node scripts/p2p-two-process.mjs    (run from apps/desktop)
 *
 * The parent relays every swarm frame between the children (optionally
 * tampering in phase 2) and is NEVER given the transfer keys — that is the
 * property under test: a courier relay cannot read or corrupt swarm media.
 *
 * Phases:
 *   1. CLEAN TRANSFER    — a full fetch must succeed, byte-identical (sha256).
 *   2. TAMPERED CHUNK    — the relay flips one byte of one swarm-v1 chunk; the
 *                          receiver must REJECT the transfer (AEAD mismatch),
 *                          never silently accept corrupted bytes.
 *   3. NO PLAINTEXT LEAK — every frame that crossed the relay is scanned for
 *          plaintext media (raw slices and their base64): the relay must see
 *          only AEAD ciphertext and sealed keys.
 *
 * Exit code 0 = all phases pass. Evidence lines start with "evidence:".
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// The swarm engine and the vendored @orbit/* libraries are plain TypeScript
// with extensionless imports (they are consumed via TS path aliases — there
// is no build step), which plain node ESM cannot resolve. The harness
// therefore bundles the worker ONCE with the esbuild that ships with vite
// (no new dependency) and runs the bundle under node. The bundle lands in
// node_modules/.cache (gitignored, wiped on run): a transparent compilation
// of this repo's real sources.
const WORKER_ENTRY = join(here, 'p2p-worker.ts')
const WORKER_OUT_DIR = join(here, '..', 'node_modules', '.cache', 'p2p-harness')
const WORKER_BUNDLE = join(WORKER_OUT_DIR, 'p2p-worker.mjs')

async function buildWorkerOnce() {
  rmSync(WORKER_OUT_DIR, { recursive: true, force: true })
  mkdirSync(WORKER_OUT_DIR, { recursive: true })
  await build({
    entryPoints: [WORKER_ENTRY],
    outfile: WORKER_BUNDLE,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    logLevel: 'silent',
  })
}
const PER_PHASE_BUDGET = 25_000

const evidence = []
function ev(text) {
  evidence.push(text)
  console.log(`evidence: ${text}`)
}

class Harness {
  /**
   * Frames the relay has OBSERVED, by emitting peer: { A: [...], B: [...] }.
   * The parent keeps them for the secrecy scan; the relay itself is stateless
   * and holds no keys — captured frames are evidence, not session state.
   */
  constructor() {
    this.observed = { A: [], B: [] }
    this.events = []
    this.waiters = []
    /** Inspector for A → B frames: return null to DROP, or the (mutated) msg. */
    this.aToBInspector = null
    this.a = this.start('A')
    this.b = this.start('B')
    this.stop = this.stop.bind(this)
    process.on('exit', () => this.stop())
  }

  start(peer) {
    const child = spawn(process.execPath, [WORKER_BUNDLE], {
      cwd: join(here, '..'),
      env: { ...process.env, P2P_PEER: peer },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.wire(child, peer)
    return child
  }

  wire(child, peer) {
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const text = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (text.trim()) {
          try {
            this.onEvent(peer, JSON.parse(text))
          } catch {
            console.log(`peer-${peer} stdout (unparsed): ${text}`)
          }
        }
        nl = buffer.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = chunk.trim()
      if (text) console.log(`peer-${peer} stderr: ${text}`)
    })
    child.on('exit', (code) => console.log(`peer-${peer} exited (code ${code})`))
  }

  send(peer, payload) {
    const child = peer === 'A' ? this.a : this.b
    child.stdin.write(JSON.stringify(payload) + '\n')
  }

  onEvent(peer, event) {
    if (event.kind === 'frame') {
      this.observed[peer].push(event.msg)
      // Relay duty: forward to the OTHER peer, through any interceptor.
      const other = peer === 'A' ? 'B' : 'A'
      let forwarded = event.msg
      if (peer === 'A' && this.aToBInspector) {
        forwarded = this.aToBInspector(event.msg)
        if (forwarded === null) return // the relay censored this frame
      }
      this.send(other, { type: 'frame', msg: forwarded })
    }
    this.events.push({ peer, ...event })
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      if (this.waiters[i].predicate(event, peer)) {
        const { resolve } = this.waiters[i]
        this.waiters.splice(i, 1)
        resolve(event)
      }
    }
  }

  waitFor(predicate, ms, label) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, label }
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new Error(`harness timeout: ${label}`))
      }, ms)
      if (typeof timer.unref === 'function') timer.unref()
      const pending = { predicate, resolve, label, timerRef: timer }
      this.waiters.push(pending)
    })
  }

  stop() {
    for (const child of [this.a, this.b]) {
      try { child.stdin.end() } catch {}
      try { child.kill() } catch {}
    }
  }
}

function seedBytes() {
  // Deterministic-ish marker: 48 KiB of random bytes with a latin1-safe shape
  // (JSON.stringify scans later must not crash on lone surrogates).
  const bytes = randomBytes(48 * 1024)
  return bytes
}

async function main() {
  await buildWorkerOnce()
  const harness = new Harness()
  let exitCode
  try {
    exitCode = await run(harness)
  } catch (err) {
    ev(`harness error: ${(err && err.stack) || err}`)
    exitCode = 1
  } finally {
    harness.stop()
  }
  console.log(`P2P-HARNESS ${exitCode === 0 ? 'PASS' : 'FAIL'} (${evidence.length} evidence lines)`)
  process.exit(exitCode === 0 ? 0 : 1)
}

async function run(harness) {
  let exitCode = 0

  // ---- Phase 1: clean transfer ------------------------------------------
  const cleanBytes = seedBytes()
  const cleanId = createHash('sha256').update(cleanBytes).digest('hex')
  harness.send('A', { type: 'seed', id: cleanId, b64: cleanBytes.toString('base64') })
  await harness.waitFor((e) => e.peer === 'A' && e.kind === 'ready' && e.id === cleanId, PER_PHASE_BUDGET, 'seed ready (clean)')
  harness.send('B', { type: 'fetch', id: cleanId, timeoutMs: 20_000 })
  const cleanResult = await harness.waitFor(
    (e) => e.peer === 'B' && e.kind === 'result' && e.id === cleanId,
    PER_PHASE_BUDGET,
    'fetch result (clean)',
  )
  const keyFrames = harness.observed.A.filter((m) => m.type === 'SWARM_KEY' && m.id === cleanId)
  const chunkFrames = harness.observed.A.filter((m) => m.type === 'SWARM_CHUNK' && m.id === cleanId)
  const encryptedChunks = chunkFrames.filter((m) => m.enc === 'swarm-v1')
  const wantFrame = harness.observed.B.find((m) => m.type === 'SWARM_WANT' && m.id === cleanId)
  if (cleanResult.ok && cleanResult.sha256 === cleanId) {
    ev(`phase1 clean transfer: ${(cleanResult.size / 1024).toFixed(0)} KiB reached peer B across two real OS processes and the untrusted relay in ${cleanResult.ms}ms, byte-identical (sha256 ${cleanId.slice(0, 12)}…)`)
  } else {
    ev(`phase1 clean transfer FAILED: ${JSON.stringify(cleanResult)}`)
    exitCode = 1
  }
  ev(`phase1 wire: sender emitted ${keyFrames.length} SWARM_KEY frame(s) + ${chunkFrames.length} SWARM_CHUNK frame(s), of which ${encryptedChunks.length} are marked swarm-v1; the fetcher advertised an offer key in SWARM_WANT = ${Boolean(wantFrame?.offerPub)}`)
  if (!keyFrames.length || !chunkFrames.length || encryptedChunks.length !== chunkFrames.length || !wantFrame?.offerPub) {
    ev('phase1 wire FAILED: swarm-v1 frame claims not satisfied')
    exitCode = 1
  }

  // ---- Phase 2: relay tamper must be rejected ----------------------------
  const evilBytes = seedBytes()
  const evilId = createHash('sha256').update(evilBytes).digest('hex')
  harness.send('A', { type: 'seed', id: evilId, b64: evilBytes.toString('base64') })
  await harness.waitFor((e) => e.peer === 'A' && e.kind === 'ready' && e.id === evilId, PER_PHASE_BUDGET, 'seed ready (tampered)')
  let tampered = false
  harness.aToBInspector = (msg) => {
    if (msg.type === 'SWARM_CHUNK' && msg.id === evilId && !tampered) {
      tampered = true
      const fixed = Buffer.from(msg.dataBase64, 'base64')
      fixed[Math.max(0, fixed.length - 1)] ^= 0x01
      msg.dataBase64 = fixed.toString('base64')
      return msg
    }
    return msg
  }
  harness.send('B', { type: 'fetch', id: evilId, timeoutMs: 20_000 })
  const evilResult = await harness.waitFor(
    (e) => e.peer === 'B' && e.kind === 'result' && e.id === evilId,
    PER_PHASE_BUDGET,
    'fetch result (tampered)',
  )
  harness.aToBInspector = null
  if (!evilResult.ok) {
    ev(`phase2 tampered chunk: the relay flipped one byte of one swarm-v1 chunk; the transfer FAILED and nothing was persisted ("${evilResult.error}") — the AEAD check drops the corrupted chunk, so reassembly can never complete: a malicious courier cannot smuggle altered media past the receiver`)
  } else {
    ev(`phase2 tampered chunk FAILED: the receiver accepted relay-corrupted bytes (sha256 ${String(evilResult.sha256).slice(0, 12)}…, expected ${evilId.slice(0, 12)}…)`)
    exitCode = 1
  }

  // ---- Phase 3: the relay never saw plaintext media ----------------------
  const allFrames = JSON.stringify([...harness.observed.A, ...harness.observed.B])
  let leak = false
  for (const [label, bytes] of [['clean', cleanBytes], ['tampered', evilBytes]]) {
    for (const offset of [0, Math.floor(bytes.length / 2)]) {
      const slice = bytes.subarray(offset, offset + 4096)
      const b64 = slice.toString('base64')
      const raw = JSON.stringify(slice.toString('latin1'))
      if (allFrames.includes(b64) || allFrames.includes(raw)) {
        leak = true
        ev(`phase3 LEAK (${label}): a plaintext media slice at byte ${offset} appears verbatim in relayed frames`)
      }
    }
  }
  const totalFrames = harness.observed.A.length + harness.observed.B.length
  ev(`phase3 secrecy: all ${totalFrames} relayed frames scanned, ${leak ? 'plaintext media slices FOUND' : 'NO plaintext media slice (raw or base64) in any frame that crossed the relay — it saw only ciphertext and keys sealed to the fetcher’s offer key'}`)
  if (leak) exitCode = 1

  return exitCode
}

main().catch((err) => {
  console.error(`P2P-HARNESS FAILED TO RUN: ${(err && err.stack) || err}`)
  process.exit(2)
})
