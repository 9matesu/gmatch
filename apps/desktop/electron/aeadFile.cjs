// AES-256-GCM envelope for media bytes written to disk, shared by the
// encrypted picture LRU (imgcache/*.enc) and the content-addressed media
// vault (media-vault/<sha256>). Adult media never lands on disk in the
// clear, so both stores use this one implementation.
//
// Layout: iv(12) | authTag(16) | ciphertext.
const crypto = require('crypto')

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * 32-byte key: the app's 64-hex storage key when present, else a
 * machine-bound fallback so an install without storage.key still encrypts
 * (same policy the LRU already used).
 */
function keyFrom(storageKeyHex, seed) {
  if (typeof storageKeyHex === 'string' && storageKeyHex.length >= 64) {
    return Buffer.from(storageKeyHex.slice(0, 64), 'hex')
  }
  return crypto.createHash('sha256').update(String(seed || 'gmatch')).digest()
}

function encrypt(buf, key) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(buf), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc])
}

/** Null on a short/corrupt/tampered envelope (never throws). */
function decrypt(raw, key) {
  if (!raw || raw.length < IV_BYTES + TAG_BYTES) return null
  try {
    const iv = raw.subarray(0, IV_BYTES)
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const enc = raw.subarray(IV_BYTES + TAG_BYTES)
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
  } catch {
    return null
  }
}

module.exports = { ALGO, IV_BYTES, TAG_BYTES, keyFrom, encrypt, decrypt }
