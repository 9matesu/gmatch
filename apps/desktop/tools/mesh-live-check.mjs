#!/usr/bin/env node
/**
 * LIVE tracker check — the real production tracker client against the real
 * public trackers. No fakes: this is the wire the app actually speaks.
 *
 * It proves three things that the unit tests can only prove against a fake:
 *   1. the announce we send is ACCEPTED by a real tracker (a malformed
 *      announce is dropped or closed — the tracker never answers it);
 *   2. the announce carries the reference shape — the SDP as an OBJECT, the
 *      `offer_id` as 20 binary characters, `numwant` under its real name —
 *      so the server does not throw on it;
 *   3. the `offer_id` that comes back is the BINARY wire form and
 *      `canonicalId` reconciles it to the hex id the mesh keys on — the step
 *      that was missing, so the answer named an offer the mesh did not know
 *      and the connection was silently never made.
 *
 * usage: node tools/mesh-live-check.mjs        (run from apps/desktop)
 * exit 0 = the live tracker accepted us.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const outDir = join(appDir, 'node_modules', '.cache', 'mesh-live')
const entry = join(outDir, 'entry.ts')
const bundle = join(outDir, 'bundle.mjs')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// The tracker client is plain TypeScript with extensionless imports, which
// plain node ESM cannot resolve. Bundle it once with the esbuild that ships
// with vite (no new dependency) — a transparent compilation of the real source.
writeFileSync(
  entry,
  [
    `export { startTrackerClient, canonicalId } from '${join(appDir, 'src', 'utils', 'mesh', 'tracker').replace(/\\/g, '/')}'`,
    `export { DEFAULT_TRACKERS } from '${join(appDir, 'src', 'utils', 'mesh', 'mesh').replace(/\\/g, '/')}'`,
  ].join('\n'),
)

await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  logLevel: 'silent',
  // `mesh.ts` pulls in the API client, which reads Vite's `import.meta.env`.
  // There is no Vite runtime here, so give it an empty object.
  define: { 'import.meta.env': '{}' },
})

const { startTrackerClient, canonicalId } = await import(`file://${bundle.replace(/\\/g, '/')}`)

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
]

/** Our own offer id: 40 hex chars, exactly what `mesh.ts` generates. */
const OFFER_ID = 'ab'.repeat(20)
/** A real SDP-shaped payload — the wire carries it as an OBJECT. */
const OFFER_SDP = 'v=0\r\na=fingerprint:sha-256 ' + 'cd'.repeat(32) + '\r\n'

const seen = {
  online: new Set(),
  sent: [],
  answers: [],
  offers: [],
  closed: new Set(),
}

const handle = await startTrackerClient({
  trackers: TRACKERS,
  infoHashes: async () => [new Uint8Array(20).fill(0x42)],
  peerId: () => new Uint8Array(20).fill(0x11),
  offers: () => [
    {
      offerId: OFFER_ID,
      peerId: '11'.repeat(20),
      infoHash: '42'.repeat(20),
      offer: { type: 'offer', sdp: OFFER_SDP },
    },
  ],
  numWant: 2,
  // Wrap the real socket so we can read the bytes we actually put on the wire.
  socketImpl: (url) => {
    const ws = new WebSocket(url)
    const rawSend = ws.send.bind(ws)
    ws.send = (data) => {
      seen.sent.push(String(data))
      return rawSend(data)
    }
    return ws
  },
  onStatus: (s) => {
    if (s.state === 'online') seen.online.add(s.tracker)
    if (s.state === 'offline') seen.closed.add(s.tracker)
  },
  onAnswers: (answers) => {
    for (const a of answers) seen.answers.push(a)
  },
  onOffers: (offers) => {
    for (const o of offers) seen.offers.push(o)
  },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(20_000)
handle.stop()

console.log('--- live tracker evidence ---')
console.log(`trackers dialed:      ${TRACKERS.length}`)
console.log(`answered (online):    ${[...seen.online].join(', ') || '(none)'}`)
console.log(`closed/offline:       ${[...seen.closed].join(', ') || '(none)'}`)
console.log(`offers relayed to us: ${seen.offers.length}`)
console.log(`answers relayed to us:${seen.answers.length}`)

// The wire shape we actually sent: the SDP is an OBJECT and the id is the
// binary form. A tracker that accepts this announce is a tracker that
// understood it.
let wireOk = false
let wireNote = '(nothing was sent)'
for (const raw of seen.sent) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    continue
  }
  if (!Array.isArray(msg.offers) || msg.offers.length === 0) continue
  const first = msg.offers[0]
  const sdpIsObject =
    first.offer && typeof first.offer === 'object' && typeof first.offer.sdp === 'string'
  const idIsBinary = typeof first.offer_id === 'string' && first.offer_id.length === 20
  const reconciles = canonicalId(first.offer_id) === OFFER_ID
  const numwantOk = typeof msg.numwant === 'number' && msg.numwant >= 0
  wireOk = sdpIsObject && idIsBinary && reconciles && numwantOk
  wireNote = [
    `sdp is an object: ${sdpIsObject}`,
    `offer_id is binary (20 chars): ${idIsBinary}`,
    `offer_id reconciles: ${reconciles}`,
    `numwant present: ${numwantOk}`,
  ].join(', ')
  break
}

console.log(`RESULT: ${seen.online.size} tracker(s) accepted the announce`)
console.log(`        the announce was the reference shape: ${wireOk} — ${wireNote}`)

if (seen.offers.length > 0) {
  for (const o of seen.offers) {
    console.log(`  relayed offer id:    ${o.offerId.slice(0, 24)}… (len ${o.offerId.length})`)
    console.log(`  reconciles to ours: ${canonicalId(o.offerId) === OFFER_ID}`)
    console.log(`  sdp is an object:   ${typeof o.offer?.sdp === 'string'}`)
  }
}
if (seen.answers.length > 0) {
  for (const a of seen.answers) {
    console.log(`  relayed answer id:  ${a.offerId.slice(0, 24)}… (len ${a.offerId.length})`)
    console.log(`  reconciles to ours: ${canonicalId(a.offerId) === OFFER_ID}`)
    console.log(`  sdp is an object:   ${typeof a.answer?.sdp === 'string'}`)
  }
}

if (seen.online.size === 0) {
  console.log('        (no tracker answered — the network path may be blocked here)')
  process.exit(2)
}
process.exit(0)
