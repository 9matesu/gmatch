// Minimal Ed25519 identity generator for E2E seeding (mirrors @orbit/crypto
// shape; runs in plain node for the playwright test process).
const { ed25519 } = require('@noble/curves/ed25519')
const { sha256 } = require('@noble/hashes/sha256')
const { x25519 } = require('@noble/curves/ed25519')
const { bytesToHex } = require('@noble/hashes/utils')

function generateIdentity() {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  const encPriv = x25519.utils.randomPrivateKey()
  const encPub = x25519.getPublicKey(encPriv)
  return {
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKey),
    encryptionPrivHex: bytesToHex(encPriv),
    encryptionPubHex: bytesToHex(encPub),
    orbitId: bytesToHex(sha256(publicKey)),
  }
}

module.exports = { generateIdentity }
