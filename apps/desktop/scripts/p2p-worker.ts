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
 *   { type:'publish', id, mime? }                       signed post.create
 *   { type:'op', operation }                            ingest a relayed op
 *   { type:'fetch-post', operationId, timeoutMs? }      post -> media via log
 *   { type:'restart' }                                  volatile reset + hydrate
 *   { type:'resolve', id }                              durable-store read-back
 *   { type:'receipt', id }                              custody-evidence lookup
 */
import 'fake-indexeddb/auto'
import { generateIdentity } from '@orbit/crypto'
import {
  __resetLocalObjectCacheForTests,
  __resetReceiptStateForTests,
  __resetWantedObjectsForTests,
  getDurableReplication,
  getLocalObject,
  handleSwarmMessage,
  hydrateDurableReplications,
  hydrateLocalObjects,
  registerLocalObject,
  requestSwarmObject,
  setSwarmReceiptIdentity,
  setSwarmTransport,
  sha256HexBlob,
} from '../src/utils/p2pSwarm.ts'
import { sharedSocialOperationLog } from '../src/services/socialOperationLog.ts'
import { acceptInboundOperation } from '../src/services/socialOpTransport.ts'
import { publishSignedPostOperation } from '../src/services/socialPublish.ts'

// The durable store (utils/storage) refuses to open IndexedDB without a
// window (an SSR guard). In this harness the worker process IS the window:
// fake-indexeddb backs globalThis.indexedDB and the engine runs unchanged.
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = globalThis
}
// The social-op module graph reads localStorage; node has none. An in-memory
// shim keeps the production code paths honest (nothing fake is injected into
// crypto, storage or the engine).
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => void store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    } as Storage,
  })
}

const PEER = process.env.P2P_PEER ?? 'A'

// Every peer is its own REAL identity (Ed25519 + X25519, orbitId =
// sha256(pubkey)); B never shares A's keys, so actor binding is actually
// exercised, and receipts B signs as a fetcher attest B's own custody.
const IDENTITY = generateIdentity()
setSwarmReceiptIdentity({
  orbitId: IDENTITY.orbitId,
  publicKeyHex: IDENTITY.publicKeyHex,
  privateKeyHex: IDENTITY.privateKeyHex,
})

function emit(value: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(value) + '\n')
}

setSwarmTransport((msg) => {
  emit({ kind: 'frame', peer: PEER, msg })
})

emit({ kind: 'identity', peer: PEER, orbitId: IDENTITY.orbitId, publicKeyHex: IDENTITY.publicKeyHex })

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

async function handleCommand(cmd: {
  type: string
  id?: string
  mime?: string
  b64?: string
  timeoutMs?: number
  operationId?: string
  operation?: unknown
}) {
  const log = sharedSocialOperationLog()
  try {
    if (cmd.type === 'seed' && cmd.id && cmd.b64) {
      const blob = decode(cmd.b64)
      registerLocalObject(cmd.id, blob)
      const digest = await sha256HexBlob(blob)
      emit({ kind: 'ready', peer: PEER, id: cmd.id, sha256: digest, size: blob.size })
      return
    }
    // Sign a post.create over ALREADY-durable local bytes (the parent seeded
    // them) and hand the signed operation to the parent for relay — exactly
    // how SWARM_OP travels. objectId = contentCid = sha256(bytes): the object
    // identity is content-addressed, never locally minted.
    if (cmd.type === 'publish' && cmd.id) {
      const blob = await getLocalObject(cmd.id)
      if (!blob) {
        emit({ kind: 'error', peer: PEER, message: `publish: no local object ${cmd.id}` })
        return
      }
      const operation = await publishSignedPostOperation(IDENTITY, {
        objectId: cmd.id,
        contentCid: cmd.id,
        mimeType: cmd.mime || 'application/octet-stream',
        sizeBytes: blob.size,
      }, log)
      emit({ kind: 'op', peer: PEER, id: cmd.id, orbitId: IDENTITY.orbitId, operation })
      return
    }
    // Ingest a relayed signed operation through the production validation
    // path (signature, actor binding, manifest self-consistency, idempotency).
    if (cmd.type === 'op' && cmd.operation) {
      const outcome = await acceptInboundOperation(log, cmd.operation)
      const op = cmd.operation as { actorId?: string; objectId?: string; payload?: { contentCid?: string } }
      emit({
        kind: 'accepted',
        peer: PEER,
        id: op.payload?.contentCid ?? op.objectId,
        operationId: (op as { operationId?: string }).operationId,
        outcome,
        actorId: op.actorId,
      })
      return
    }
    // Resolve a post's media FROM the accepted operation in our own durable
    // log (the author's manifest claim), then swarm-fetch with the expected
    // hash pulled from the payload — never from the transport.
    if (cmd.type === 'fetch-post' && cmd.operationId) {
      const started = Date.now()
      const entry = await log.getEntry(cmd.operationId)
      const cid = (entry?.record as { payload?: { contentCid?: unknown } } | undefined)
        ?.payload?.contentCid
      const done = (ok: boolean, sha256?: string, size?: number, error?: string) =>
        emit({
          kind: 'result', peer: PEER, id: cmd.operationId, ok, sha256, size,
          contentCid: typeof cid === 'string' ? cid : undefined,
          error, ms: Date.now() - started,
        })
      if (typeof cid !== 'string' || !cid) {
        done(false, undefined, undefined, 'operation has no contentCid')
        return
      }
      try {
        const blob = await requestSwarmObject(cid, cmd.timeoutMs ?? 20_000, { expectedHash: cid })
        const bytes = Buffer.from(await blob.arrayBuffer())
        done(true, (await sha256HexBlob(blob)), bytes.byteLength)
      } catch (err) {
        done(false, undefined, undefined, String(err instanceof Error ? err.message : err))
      }
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
    // Simulated app restart: drop ALL volatile engine state, sever the
    // transport (from here on there is no network), and rebuild from the
    // durable store only — what a rebooted client can and must do.
    if (cmd.type === 'restart') {
      __resetLocalObjectCacheForTests()
      __resetWantedObjectsForTests()
      __resetReceiptStateForTests()
      setSwarmTransport(null)
      const hydrated = await hydrateLocalObjects()
      const receipts = await hydrateDurableReplications()
      emit({ kind: 'restarted', peer: PEER, hydrated, receipts })
      return
    }
    // Post-restart media resolution with no transport: durable store only.
    if (cmd.type === 'resolve' && cmd.id) {
      const blob = await getLocalObject(cmd.id)
      if (!blob || blob.size === 0) {
        emit({ kind: 'resolved', peer: PEER, id: cmd.id, ok: false, error: 'absent' })
        return
      }
      emit({
        kind: 'resolved',
        peer: PEER,
        id: cmd.id,
        ok: true,
        sha256: await sha256HexBlob(blob),
        size: blob.size,
      })
      return
    }
    // Durable-custody evidence held by this peer (fetcher receipts) or
    // received attestations (seeder receipts, e.g. peer B's receipt at peer A).
    if (cmd.type === 'receipt' && cmd.id) {
      const entry = getDurableReplication(cmd.id)
      const receipt = entry?.receipt as { receiverId?: string } | undefined
      emit({
        kind: 'durable',
        peer: PEER,
        id: cmd.id,
        ok: Boolean(entry),
        attestor: receipt?.receiverId,
        confirmedAt: entry?.confirmedAt,
      })
      return
    }
    if (cmd.type === 'frame' && cmd.msg) {
      // The relay brought us a swarm frame: pump it through the production
      // inbound path (WANT serving, KEY unwrap, chunk reassembly).
      const handled = await handleSwarmMessage(cmd.msg)
      const msgType = (cmd.msg as { type?: string }).type
      if (msgType === 'SWARM_CHALLENGE' || msgType === 'SWARM_RECEIPT') {
        emit({ kind: 'log', peer: PEER, message: `${msgType} ${String((cmd.msg as { id?: string }).id).slice(0, 8)} handled=${handled}` })
      }
      if (!handled) emit({ kind: 'log', peer: PEER, message: 'frame not handled' })
      return
    }
    emit({ kind: 'log', peer: PEER, message: `ignored command ${cmd.type}` })
  } catch (err) {
    emit({ kind: 'error', peer: PEER, message: String(err) })
  }
}
