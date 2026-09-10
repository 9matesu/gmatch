import {
  encryptPayload,
  decryptPayload,
  encryptWithDek,
  decryptWithDek,
  signMessage,
  verifySignature,
  hexToBytes,
  bytesToHex,
} from '@orbit/crypto'
import { deliveryToken } from './mail'
import { sha256Hex } from './hash'

/**
 * Sealed Envelope v2 — the only thing the courier ever sees.
 *
 * Wire fields: `to` (a delivery token — opaque 64-hex), `kind` (routing
 * class), `id`, `sealed` (base64 blob), `exp` (TTL hint). Everything
 * semantic — the sender's name-bearing orbitId, the body, the binding to the
 * routing fields — lives inside `sealed`, so a courier that forwards
 * addresses learns nothing about who sent what.
 *
 * `fromEph` carries the sender's STATIC X25519 encryption pubkey, which
 * ECIES requires to compute the shared secret. It is public key material
 * unrelated to the Ed25519 signing key, so it maps to no identity by itself;
 * tampering with it just makes the envelope undecryptable.
 */
export type EnvelopeKind = 'mail' | 'signal' | 'announce' | 'invite' | 'report' | 'api_req'

export interface Envelope {
  v: 2
  kind: EnvelopeKind
  /** delivery token (recipient) or room id (group fan-out) — routing only. */
  to: string
  id: string
  sealed: string
  /** sender X25519 enc pubkey (ECIES input; 1:1 only). */
  fromEph?: string
  /** unix ms after which the courier may drop the envelope. */
  exp?: number
}

export interface OpenedEnvelope {
  kind: EnvelopeKind
  id: string
  to: string
  body: string
  /** Ed25519 pubkey hex of the sender (verified against inner signature). */
  senderPubHex: string
  /** sha256(senderPub) — same derivation as orbitId in @orbit/crypto. */
  senderOrbitId: string
}

export interface SenderKeys {
  privateKeyHex: string
  publicKeyHex: string
  encryptionPrivHex: string
  encryptionPubHex: string
}

interface SealedInner {
  senderPub: string
  body: string
  sig: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/**
 * Canonical bytes covered by the sender signature: routing class, envelope id
 * and address, plus the body. Binding kind/id/to means a courier or MITM
 * cannot flip the routing class or redirect a DM between kinds without
 * invalidating it; binding the body means the signature is unforgeable and
 * undetachable from the content.
 */
function signedPayload(env: Pick<Envelope, 'v' | 'kind' | 'id' | 'to'>, body: string): Uint8Array {
  return enc.encode(`v${env.v}|${env.kind}|${env.id}|${env.to}|${body}`)
}

function sealInner(body: string, kind: EnvelopeKind, to: string, id: string, sender: SenderKeys): string {
  const inner: SealedInner = {
    senderPub: sender.publicKeyHex,
    body,
    sig: bytesToHex(signMessage(signedPayload({ v: 2, kind, id, to }, body), sender.privateKeyHex)),
  }
  return bytesToBase64(enc.encode(JSON.stringify(inner)))
}

function openInner(json: string, env: Envelope): OpenedEnvelope {
  assertVersion(env)
  const inner = JSON.parse(json) as SealedInner
  if (!verifySignature(hexToBytes(inner.sig), signedPayload(env, inner.body), inner.senderPub)) {
    throw new Error('Envelope signature check failed (tampered or mis-routed)')
  }
  return {
    kind: env.kind,
    id: env.id,
    to: env.to,
    body: inner.body,
    senderPubHex: inner.senderPub,
    senderOrbitId: sha256Hex(hexToBytes(inner.senderPub)),
  }
}

function assertVersion(env: Envelope): void {
  if (env.v !== 2) throw new Error(`Unsupported envelope version: ${env.v} (expected 2)`)
}

// ---------------------------------------------------------------- 1:1 (mail)

/** X25519 ECIES seal: only the holder of the recipient encPriv opens it.
 * `to` defaults to the recipient's delivery token = blake3(Ed25519 pubkey),
 * which is also the key the courier checks ack signatures against. */
export function seal1to1(
  body: string,
  kind: EnvelopeKind,
  sender: SenderKeys,
  recipient: { publicKeyHex: string; encryptionPubHex: string },
  opts?: { id?: string; exp?: number; to?: string },
): Envelope {
  const id = opts?.id ?? newId()
  const to = opts?.to ?? deliveryToken(recipient.publicKeyHex)
  const sealedBytes = encryptPayload(enc.encode(sealInner(body, kind, to, id, sender)), sender.encryptionPrivHex, recipient.encryptionPubHex)
  const env: Envelope = { v: 2, kind, to, id, sealed: bytesToBase64(sealedBytes), fromEph: sender.encryptionPubHex }
  if (opts?.exp) env.exp = opts.exp
  return env
}

export function open1to1(env: Envelope, recipientEncPrivHex: string): OpenedEnvelope {
  if (!env.fromEph) throw new Error('Envelope missing sender encryption pubkey (fromEph)')
  const plain = decryptPayload(base64ToBytes(env.sealed), recipientEncPrivHex, env.fromEph)
  return openInner(dec.decode(base64ToBytes(dec.decode(plain))), env)
}

// ------------------------------------------------------- sealed API requests

/**
 * Sealed-request transport (security plan T2): the signed auth headers + the
 * JSON body travel inside an ECIES envelope addressed to the NODE's X25519
 * key, so mutation payloads are ciphertext even on plain-HTTP LAN self-hosts.
 * Wire format: base64(env) — the Envelope itself (kind=api_req).
 */
export interface SealedApiRequest {
  headers: Record<string, string>
  body: string
}

export function sealApiRequest(
  req: SealedApiRequest,
  sender: SenderKeys,
  nodeEncryptionPubHex: string,
  opts?: { id?: string; exp?: number },
): string {
  const env = seal1to1(JSON.stringify(req), 'api_req', sender, { publicKeyHex: sender.publicKeyHex, encryptionPubHex: nodeEncryptionPubHex }, { to: 'api', ...opts })
  return bytesToBase64(enc.encode(JSON.stringify(env)))
}

export function openApiRequest(header: string, nodeEncryptionPrivHex: string): SealedApiRequest {
  const env = JSON.parse(dec.decode(base64ToBytes(header))) as Envelope
  const opened = open1to1(env, nodeEncryptionPrivHex)
  if (opened.kind !== 'api_req') throw new Error(`not an api_req envelope (kind=${opened.kind})`)
  const parsed = JSON.parse(opened.body) as SealedApiRequest
  if (!parsed || typeof parsed !== 'object' || typeof parsed.body !== 'string' || typeof parsed.headers !== 'object') {
    throw new Error('malformed sealed api request')
  }
  return parsed
}

// --------------------------------------------------------------- group (DEK)

/** Shared-DEK seal for room fan-out: holders of the room DEK open it. */
export function sealGroup(
  body: string,
  kind: EnvelopeKind,
  sender: SenderKeys,
  roomId: string,
  dek: Uint8Array,
  opts?: { id?: string },
): Envelope {
  const id = opts?.id ?? newId()
  const json = enc.encode(sealInner(body, kind, roomId, id, sender))
  const { ciphertext, nonce } = encryptWithDek(json, dek)
  const sealed = new Uint8Array(nonce.length + ciphertext.length)
  sealed.set(nonce, 0)
  sealed.set(ciphertext, nonce.length)
  return { v: 2, kind, to: roomId, id, sealed: bytesToBase64(sealed) }
}

export function openGroup(env: Envelope, dek: Uint8Array): OpenedEnvelope {
  const raw = base64ToBytes(env.sealed)
  const json = decryptWithDek(raw.subarray(24), dek, raw.subarray(0, 24))
  return openInner(dec.decode(base64ToBytes(dec.decode(json))), env)
}

// --------------------------------------------------------------- base64 utils

/** Browser-safe base64 (no Buffer in the renderer); Buffer fallback in node. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
