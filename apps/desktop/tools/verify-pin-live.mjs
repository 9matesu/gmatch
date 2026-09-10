// P2 verification: signed verify-pin against the LIVE dev sidecar (8790).
import crypto from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { generateIdentity } = require('../src/identity.cjs')
const { signMessage } = await import('@orbit/crypto')

const id = generateIdentity()
const body = JSON.stringify({ pin: process.argv[2] })
const ts = Date.now().toString()
const nonce = crypto.randomBytes(16).toString('hex')
const payload = `POST|/api/admin/verify-pin|${ts}|${nonce}|${body}`
const sig = signMessage(new TextEncoder().encode(payload), id.privateKeyHex)
const hex = Buffer.from(sig).toString('hex')
const res = await fetch('http://127.0.0.1:8790/api/admin/verify-pin', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Orbit-Id': id.orbitId,
    'X-Orbit-Timestamp': ts,
    'X-Orbit-Signature': hex,
    'X-Orbit-PubKey': id.publicKeyHex,
    'X-Orbit-Nonce': nonce,
  },
  body,
})
console.log(res.status, JSON.stringify(await res.json()).slice(0, 140))