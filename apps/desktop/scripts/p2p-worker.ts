/**
 * One swarm peer, in its own REAL process (roadmap P1 #7).
 *
 * The harness parent (`p2p-two-process.mjs`) spawns two of these. Each child
 * runs the production swarm engine (`src/utils/p2pSwarm.ts`) — the same code
 * the Electron renderer runs — and pipes its swarm frames to the parent as
 * JSON lines. The parent acts as an UNTRUSTED RELAY: it forwards every frame
 * between the children (optionally tampering) and is never given the keys.
 *
 * stdout protocol (one JSON object per line):
 *   { kind:'frame',  peer, msg }  an outgoing swarm frame
 *   { kind:'ready',  peer, id }   a seed registered locally
 *   { kind:'result', peer, id, ok, b64?, error?, ms? }  a fetch outcome
 *   { kind:'log',    peer, message }
 *
 * stdin protocol (one JSON command per line):
 *   { type:'seed', id, mime, b64 }
 *   { type:'fetch', id, timeoutMs? }
 */
import 'fake-indexeddb/auto'
import {
  handleSwarmMessage,
  registerLocalObject,
  requestSwarmObject,
  setSwarmTransport,
  sha256HexBlob,
} from '../src/utils/p2pSwarm.ts'

// The durable store (utils/storage) refuses to open IndexedDB without a
// window (an SSR guard). In this harness the worker process IS the window:
// fake-indexeddb backs globalThis.indexedDB and the engine runs unchanged.
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = globalThis
}

const PEER = process.env.P2P_PEER ?? 'A'

function emit(value: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(value) + '\n')
}

setSwarmTransport((msg) => {
  emit({ kind: 'frame', peer: PEER, msg })
})

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const text = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (text.trim()) void handleCommand(JSON.parse(text))
    newline = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))

function decode(b64: string): Blob {
  const buf = Buffer.from(b64, 'base64')
  return new Blob([buf], { type: 'application/octet-stream' })
}

async function handleCommand(cmd: { type: string; id: string; mime?: string; b64?: string; timeoutMs?: number }) {
  try {
    if (cmd.type === 'seed' && cmd.b64) {
      const blob = decode(cmd.b64)
      registerLocalObject(cmd.id, blob)
      const digest = await sha256HexBlob(blob)
      emit({ kind: 'ready', peer: PEER, id: cmd.id, sha256: digest, size: blob.size })
      return
    }
    if (cmd.type === 'frame' && cmd.msg) {
      // The relay brought us a swarm frame: pump it through the production
      // inbound path (WANT serving, KEY unwrap, chunk reassembly).
      const handled = await handleSwarmMessage(cmd.msg)
      if (!handled) emit({ kind: 'log', peer: PEER, message: 'frame not handled' })
      return
    }
    if (cmd.type === 'fetch' && cmd.id) {
      const started = Date.now()
      try {
        const blob = await requestSwarmObject(cmd.id, cmd.timeoutMs ?? 15000)
        const bytes = Buffer.from(await blob.arrayBuffer())
        const digest = await sha256HexBlob(blob)
        emit({
          kind: 'result',
          peer: PEER,
          id: cmd.id,
          ok: true,
          size: bytes.byteLength,
          sha256: digest,
          ms: Date.now() - started,
        })
      } catch (err) {
        emit({
          kind: 'result',
          peer: PEER,
          id: cmd.id,
          ok: false,
          error: String(err instanceof Error ? err.message : err),
          ms: Date.now() - started,
        })
      }
      return
    }
    emit({ kind: 'log', peer: PEER, message: `ignored command ${cmd.type}` })
  } catch (err) {
    emit({ kind: 'error', peer: PEER, message: String(err) })
  }
}
