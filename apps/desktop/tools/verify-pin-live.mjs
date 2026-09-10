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
if (process.argv[3] === '--double') {
  // Same identity, two credits with distinct Idempotency-Keys => #2 must 429
  // with retryInMs + Retry-After (the wallet-sync backoff contract).
  const call = async (n) => {
    const body = JSON.stringify({ amount: 100, session: 'perf-check', gps: 10 })
    const t = Date.now().toString()
    const nonce = crypto.randomBytes(16).toString('hex')
    const payload = `POST|/api/economy/idle-credit|${t}|${nonce}|${body}`
    const sig = signMessage(new TextEncoder().encode(payload), id.privateKeyHex)
    return fetch('http://127.0.0.1:8790/api/economy/idle-credit', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Orbit-Id': id.orbitId, 'X-Orbit-Timestamp': t, 'X-Orbit-Signature': Buffer.from(sig).toString('hex'), 'X-Orbit-PubKey': id.publicKeyHex, 'X-Orbit-Nonce': nonce, 'Idempotency-Key': 'perf-' + n + '-' + t }, body })
  }
  const a = await call(1)
  console.log('credit#1', a.status, (await a.json()).balance !== undefined ? '(credited)' : '')
  const b2 = await call(2)
  console.log('credit#2', b2.status, 'Retry-After:', b2.headers.get('retry-after'), JSON.stringify(await b2.json()).slice(0, 140))
}
