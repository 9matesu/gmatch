import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = process.env.STORAGE_ENCRYPTION_KEY
  if (!hex || hex === '00'.repeat(32)) {
    throw new Error('STORAGE_ENCRYPTION_KEY must be set to a non-zero 64-character hex string (32 bytes)')
  }
  if (hex.length !== 64) {
    throw new Error('STORAGE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptBlob(plaintext: Uint8Array): Uint8Array {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted])
}

export function decryptBlob(data: Uint8Array): Uint8Array {
  const key = getKey()
  const iv = data.slice(0, IV_LENGTH)
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = data.slice(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(Buffer.from(authTag))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
}

/**
 * Encrypt a string for at-rest storage using the same STORAGE_ENCRYPTION_KEY.
 * Returns a `enc:v1:<base64>` string suitable for a TEXT column. This keeps
 * moderator-readable content (DMs, etc.) encrypted in the database while the
 * server can still decrypt it for delivery and moderation — a raw DB dump no
 * longer exposes plaintext, without sacrificing the moderation-first model.
 */
const TEXT_PREFIX = 'enc:v1:'

export function encryptText(plaintext: string): string {
  const encrypted = encryptBlob(new TextEncoder().encode(plaintext))
  return TEXT_PREFIX + Buffer.from(encrypted).toString('base64')
}

/**
 * Decrypt a value produced by `encryptText`. Legacy plaintext rows (no
 * `enc:v1:` prefix) pass through untouched, and any decrypt failure returns
 * the stored value rather than throwing, so mixed/legacy data never breaks
 * delivery.
 */
export function decryptText(value: string): string {
  if (!value) return value
  if (!value.startsWith(TEXT_PREFIX)) return value
  try {
    const raw = Buffer.from(value.slice(TEXT_PREFIX.length), 'base64')
    return new TextDecoder().decode(decryptBlob(raw))
  } catch {
    return value
  }
}

/**
 * Generate a time-limited HMAC-SHA256 signature for streaming object media without headers.
 */
export function createSignedObjectToken(
  objectId: string,
  ttlSeconds: number = 7 * 3600
): { sig: string; exp: number } {
  const key = getKey()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = `obj:${objectId}:${exp}`
  const sig = createHmac('sha256', key).update(payload).digest('hex')
  return { sig, exp }
}

/**
 * Verify a time-limited HMAC-SHA256 signature token.
 */
export function verifySignedObjectToken(
  objectId: string,
  sig: string,
  exp: number
): boolean {
  if (!objectId || !sig || !exp) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec > exp) return false // Expired

  try {
    const key = getKey()
    const payload = `obj:${objectId}:${exp}`
    const expectedSig = createHmac('sha256', key).update(payload).digest('hex')
    const sigBuf = Buffer.from(sig, 'hex')
    const expectedBuf = Buffer.from(expectedSig, 'hex')
    if (sigBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(sigBuf, expectedBuf)
  } catch {
    return false
  }
}
