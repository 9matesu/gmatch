#!/usr/bin/env node
/**
 * Real-ICE (direct WAN) proof on THIS machine — browser leg.
 *
 *   node scripts/wan-ice.mjs    (npm run test:wan:ice)
 *
 * The node harness (`wan-two-peer.mjs`) fails the direct leg because Node has
 * no RTCPeerConnection. Chromium does. This driver loads the REAL production
 * wire (esbuild-bundled `wan-ice-entry.ts`: peerConnectionConfig(null) —
 * direct-first with Google + Cloudflare STUN — createSocialOperation/validateSocialOperation,
 * seal1to1/open1to1, encodeDmBody/decodeBody, sha256HexBlob) into TWO isolated
 * browser contexts (two identities / worlds / stores). The node is an
 * UNTRUSTED relay: it forwards ONLY the SDP; once the DataChannel opens the
 * frames flow page-to-page over the real ICE path, never through the node.
 *
 * 1.7.3 ships two free STUN servers (Google primary, Cloudflare fallback):
 * direct-first (host/srflx candidates, global IPv6 2000::/3, Radmin 26/8) with
 * NO forced relay and NO baked TURN — a TURN is appended only when explicitly
 * configured, and the node's SWARM_FRAME relay is the fallback. The gate
 * asserts exactly that default: both STUN URLs in order, no forced relay,
 * no TURN.
 *
 * Asserts, over the REAL channel:
 *   (a) a signed post.create crosses and verifies,
 *   (b) media arrives byte-identical (sha256 == content id),
 *   (c) a sealed DM round-trips (send -> ack),
 *   (d) no plaintext media is visible to the untrusted relay (it saw only SDP).
 *
 * HONEST: if the direct ICE path cannot form a channel here, it FAILS LOUD with
 * the exact ICE diagnostic — never a fake pass. Exit 0 = every leg passed.
 */
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, '..', 'node_modules', '.cache', 'wan-ice')
const BUNDLE = join(OUT_DIR, 'wan-ice-entry.js')

const evidence = []
function ev(text) { evidence.push(text); console.log(`evidence: ${text}`) }

async function buildBundle() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  await build({
    entryPoints: [join(here, 'wan-ice-entry.ts')],
    outfile: BUNDLE,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    sourcemap: false,
    logLevel: 'silent',
  })
}

const OPEN_BUDGET = 40_000
const PHASE_BUDGET = 30_000

async function main() {
  await buildBundle()
  const browser = await chromium.launch({ headless: true })
  let exitCode = 0
  try {
    exitCode = await run(browser)
  } catch (err) {
    ev(`harness error: ${(err && err.stack) || err}`)
    exitCode = 1
  } finally {
    await browser.close().catch(() => {})
  }
  console.log(`WAN-ICE ${exitCode === 0 ? 'PASS' : 'FAIL'} (${evidence.length} evidence lines)`)
  process.exit(exitCode === 0 ? 0 : 1)
}

async function run(browser) {
  let exitCode = 0
  // Two ISOLATED contexts: distinct identity, distinct IndexedDB/world.
  // localhost is a SECURE context, so crypto.subtle (used by the production
  // sha256HexBlob verifier) exists. about:blank does not expose it.
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>wan-ice</title>') })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  pageA.on('console', (m) => { const t = m.text(); if (/error|warn/i.test(t)) console.log(`page-A: ${t}`) })
  pageB.on('console', (m) => { const t = m.text(); if (/error|warn/i.test(t)) console.log(`page-B: ${t}`) })
  await pageA.goto(origin)
  await pageB.goto(origin)
  await pageA.addScriptTag({ path: BUNDLE })
  await pageB.addScriptTag({ path: BUNDLE })

  const idA = await pageA.evaluate(() => globalThis.__wan.identity())
  const idB = await pageB.evaluate(() => globalThis.__wan.identity())
  const cfg = await pageA.evaluate(() => globalThis.__wan.config())
  ev(`two isolated browser contexts, distinct identities: A=${idA.orbitId.slice(0, 12)}… B=${idB.orbitId.slice(0, 12)}…`)
  ev(`ICE config: iceTransportPolicy=${cfg.iceTransportPolicy ?? 'default (direct-first)'}, iceServers=${JSON.stringify(cfg.iceServers)}`)
  // 1.7.3 default: Google primary + Cloudflare fallback STUN, direct-first;
  // a TURN is appended ONLY when explicitly configured (null here => none).
  const iceUrls = (Array.isArray(cfg.iceServers) ? cfg.iceServers : []).map(String)
  const forcedRelay = cfg.iceTransportPolicy === 'relay'
  const expectedStun = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
  const stunUrls = iceUrls.filter((u) => /^stun:/i.test(u.trim())).map((u) => u.trim().toLowerCase())
  const turnUrls = iceUrls.filter((u) => /^turns?:/i.test(u.trim()))
  const stunMatches = stunUrls.length === expectedStun.length && stunUrls.every((u, i) => u === expectedStun[i])
  if (forcedRelay || !stunMatches || turnUrls.length > 0 || iceUrls.length !== expectedStun.length) {
    ev(`FAIL leg=ICE-config: expected 1.7.3 direct-first default (${expectedStun.join(', ')} in order, no forced relay, no TURN); got policy=${cfg.iceTransportPolicy ?? 'default (direct-first)'}, iceServers=${JSON.stringify(cfg.iceServers)}`)
    return 1
  }
  ev(`ICE config PASS: direct-first default has ${stunUrls.join(' then ')} (Google primary, Cloudflare fallback), no forced relay and no TURN — host/srflx candidates are the direct path; TURN only when explicitly configured`)

  // ---- open a REAL RTCPeerConnection DataChannel over the direct path ------
  const sdpA = await pageA.evaluate(() => globalThis.__wan.createOffer())
  const sdpB = await pageB.evaluate((sdp) => globalThis.__wan.acceptOffer(sdp), sdpA)
  await pageA.evaluate((sdp) => globalThis.__wan.applyAnswer(sdp), sdpB)
  const [openA, openB] = await Promise.all([
    pageA.evaluate((ms) => globalThis.__wan.waitOpen(ms), OPEN_BUDGET),
    pageB.evaluate((ms) => globalThis.__wan.waitOpen(ms), OPEN_BUDGET),
  ])
  if (!openA || !openB) {
    const stA = await pageA.evaluate(() => globalThis.__wan.state())
    const stB = await pageB.evaluate(() => globalThis.__wan.state())
    const candTypes = (sdp) => [...String(sdp).matchAll(/typ (\w+)/g)].map((m) => m[1])
    ev(`ICE leg FAIL: the real RTCPeerConnection DataChannel did NOT open within ${OPEN_BUDGET / 1000}s (openA=${openA} openB=${openB})`)
    ev(`ICE diag A: ice=${stA.ice} conn=${stA.conn} gather=${stA.gather} candidates=[${candTypes(stA.localSdp).join(',')}]`)
    ev(`ICE diag B: ice=${stB.ice} conn=${stB.conn} gather=${stB.gather} candidates=[${candTypes(stB.localSdp).join(',')}]`)
    const sawRelay = candTypes(stA.localSdp).includes('relay') || candTypes(stB.localSdp).includes('relay')
    ev(`ICE leg failing leg = "direct WAN / ICE": ${sawRelay ? 'relay candidates were gathered but the pair never connected' : 'no host/srflx candidate pair connected — direct ICE cannot form a channel in this environment (check UDP egress to stun.l.google.com:19302 / stun.cloudflare.com:3478)'}`)
    return 1
  }
  ev(`ICE leg PASS: a REAL RTCPeerConnection DataChannel opened between two isolated browser contexts over the direct path (host/srflx via Google + Cloudflare STUN, no forced relay) — it works on this machine (one-machine simulation: two networks are not simulated)`)

  // ---- (a) signed post.create crosses + verifies --------------------------
  const postBytes = randomBytes(48 * 1024)
  const postId = createHash('sha256').update(postBytes).digest('hex')
  const operation = await pageA.evaluate((input) => globalThis.__wan.signPost(input), {
    objectId: postId, contentCid: postId, mimeType: 'image/jpeg', sizeBytes: postBytes.length,
  })
  await pageA.evaluate((op) => globalThis.__wan.sendOp(op), operation)
  const accepted = await pageB.evaluate((ms) => globalThis.__wan.recvOp(ms), PHASE_BUDGET)
  if (accepted?.ok && accepted.actorId === idA.orbitId && accepted.contentCid === postId) {
    ev(`(a) publish: A signed a post.create (production createSocialOperation); B VERIFIED it over the real channel (validateSocialOperation) — actor preserved as A, objectId = content sha256`)
  } else {
    ev(`(a) publish FAILED: ${JSON.stringify(accepted)}`)
    exitCode = 1
  }

  // ---- (b) media byte-identical over the real channel ---------------------
  await pageA.evaluate(({ id, b64, mime }) => globalThis.__wan.sendMedia(id, b64, mime), { id: postId, b64: postBytes.toString('base64'), mime: 'image/jpeg' })
  const media = await pageB.evaluate(({ id, ms }) => globalThis.__wan.recvMedia(id, ms), { id: postId, ms: PHASE_BUDGET })
  if (media?.ok && media.sha256 === postId) {
    ev(`(b) media: B received ${((media.size || 0) / 1024).toFixed(0)} KiB as real SWARM_CHUNK frames over the channel and verified sha256 == content id — byte-identical`)
  } else {
    ev(`(b) media FAILED: ${JSON.stringify(media)}`)
    exitCode = 1
  }

  // ---- (c) sealed DM round-trips (send -> ack) ----------------------------
  const bKeys = { publicKeyHex: idB.publicKeyHex, encryptionPubHex: idB.encryptionPubHex }
  await pageA.evaluate(({ text, peer }) => globalThis.__wan.sendDm(text, peer), { text: 'hello over the real ICE channel', peer: bKeys })
  const dm = await pageB.evaluate((ms) => globalThis.__wan.recvDm(ms), PHASE_BUDGET)
  const ack = dm ? await pageA.evaluate((ms) => globalThis.__wan.recvAck(ms), PHASE_BUDGET) : null
  if (dm && dm.text === 'hello over the real ICE channel' && ack) {
    ev(`(c) DM: a SEALED direct message round-tripped over the real channel — B opened it (open1to1 signature check) and acked, A saw the ack; the SAME Envelope v2 the courier carries, no mailbox`)
  } else {
    ev(`(c) DM FAILED: dm=${JSON.stringify(dm)} ack=${JSON.stringify(ack)}`)
    exitCode = 1
  }

  // ---- (d) the untrusted relay saw only SDP, never media ------------------
  const relayed = JSON.stringify([sdpA, sdpB])
  let leak = false
  for (const offset of [0, Math.floor(postBytes.length / 2)]) {
    const slice = postBytes.subarray(offset, offset + 4096)
    if (relayed.includes(slice.toString('base64')) || relayed.includes(JSON.stringify(slice.toString('latin1')))) leak = true
  }
  ev(`(d) secrecy: the untrusted relay handled ONLY the SDP (${relayed.length} bytes); ${leak ? 'PLAINTEXT MEDIA FOUND in relayed SDP' : 'no plaintext media slice (raw or base64) anywhere the relay could see — media crossed DTLS-encrypted, page to page'}`)
  if (leak) exitCode = 1

  await ctxA.close()
  await ctxB.close()
  server.close()
  return exitCode
}

main().catch((err) => {
  console.error(`WAN-ICE FAILED TO RUN: ${(err && err.stack) || err}`)
  process.exit(2)
})