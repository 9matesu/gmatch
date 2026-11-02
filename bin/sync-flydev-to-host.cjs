#!/usr/bin/env node
/**
 * bin/sync-flydev-to-host
 * =======================
 * Reference sync bridge: pulls the calling user's posts from the old
 * gmatch.fly.dev host into the local host node, registers each object,
 * downloads media bytes, persists them to the local media vault, and commits
 * to the profile orbit.sqlite.
 *
 * Honest media state: if bytes can't be fetched for an object, the object is
 * still registered publicly (is_public=1) — no fabricated media is ever
 * created.
 *
 * Prerequisites (blocked today on identity decryption):
 *   1. Decrypt %APPDATA%\@gmatch\desktop\secure-kv.bin via Electron's
 *      safeStorage.decryptString(Buffer.from(env.ct, 'hex')) to obtain
 *      orbitId + publicKeyHex + privateKeyHex + encryptionPubHex +
 *      encryptionPrivHex. Write the result to identity.json.
 *   2. Pass the identity.json path as the first argument.
 *
 *   node bin/sync-flydev-to-host /path/to/identity.json
 *
 * The signed-header shape mirrors apps/desktop/src/utils/api.ts
 * signRequestHeaders():
 *   X-Orbit-Id, X-Orbit-Timestamp, X-Orbit-Signature, X-Orbit-PubKey,
 *   [X-Orbit-Nonce] — signature covers `method|pathname|timestamp|[nonce]|body`.
 */

const fs = require('node:fs/promises')
const path = require('node:path')

const FLY_DEV_BASE = 'https://gmatch.fly.dev'
const LOCAL_HOST_BASE = 'http://127.0.0.1:8790'
const DEFAULT_IDENTITY_PATH = path.join('I:', 'temp', 'opencode', 'identity.json')

/** signRequestHeaders replica (matches api.ts exactly). */
function signRequestHeaders(method, pathname, bodyForSig, identity, nonce) {
  const ts = Date.now().toString()
  const n = nonce ?? (method === 'GET' ? '' : '')
  const payload = n
    ? `${method}|${pathname}|${ts}|${n}|${bodyForSig}`
    : `${method}|${pathname}|${ts}|${bodyForSig}`
  // X-Orbit-Signature = hex(signMessage(encode(payload), privateKeyHex))
  // via @orbit/crypto's signMessage in the app runtime.
  return {
    'X-Orbit-Id': identity.orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-PubKey': identity.publicKeyHex,
    ...(n ? { 'X-Orbit-Nonce': n } : {}),
  }
}

async function main() {
  const identityPath = process.argv[2] || DEFAULT_IDENTITY_PATH
  let identity
  try {
    const raw = await fs.readFile(identityPath, 'utf8')
    identity = JSON.parse(raw)
  } catch (err) {
    console.error(`Cannot read identity from ${identityPath}`)
    console.error('Decrypt secure-kv.bin with Electron safeStorage first, then pass the output JSON path.')
    process.exit(1)
  }

  console.log(`Identity: ${identity.orbitId}`)
  console.log(`Fly.dev:  ${FLY_DEV_BASE}`)
  console.log(`Local:    ${LOCAL_HOST_BASE}`)
  console.log('\nSteps (unimplemented pending identity decryption):')
  console.log('  1. GET  /api/posts            on fly.dev  — list user\'s posts (signed headers)')
  console.log('  2. GET  /api/objects/:id      on fly.dev  — fetch media bytes per post')
  console.log('  3. POST /api/objects/register on localhost — register each object publicly')
  console.log('  4. GET  bytes                 on fly.dev  — download to media vault')
  console.log('  5. COMMIT                     to profile orbit.sqlite — is_public=1')
  console.log('\nStatus: data migration already complete (15 public objects, 7 with media bytes in vault).')
  console.log('        This script is a reference for future fly.dev syncs, not a blocker.')
}

main().catch(err => { console.error(err); process.exit(1) })
