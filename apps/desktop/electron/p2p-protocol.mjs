// Main-process /gmatch/1.0.0 protocol (Slice 2): one sealed Envelope-v2 per
// stream, gated by the orbit-signed PeerId binding. Main verifies the BINDING
// (public-key math only) and delivers the raw envelope to the renderer, which
// owns open1to1 + all validators. Mirror of
// packages/protocol/src/peer-binding.ts — parity pinned by the fixed vector in
// p2p-protocol.test.mjs (same vector as peer-binding.test.ts).
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { multiaddr } from '@multiformats/multiaddr'

export const GMATCH_PROTOCOL = '/gmatch/1.0.0'
export const PEER_BINDING_DOMAIN = 'gmatch-peer-binding-v1'
// Envelope sealed bodies are base64; 256 KiB caps a frame at DM-with-metadata
// scale. Oversize is dropped + counted, never truncated.
export const FRAME_MAX_BYTES = 256 * 1024

const enc = new TextEncoder()
const dec = new TextDecoder()

function isHex(s, len) {
  return typeof s === 'string' && s.length === len && /^[0-9a-f]+$/i.test(s)
}

export function verifyPeerBinding(b) {
  if (typeof b !== 'object' || b === null) return false
  const { orbitId, orbitPubkeyHex, peerId, sigHex } = b
  if (!isHex(orbitId, 64) || !isHex(orbitPubkeyHex, 64) || !isHex(sigHex, 128)) return false
  if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 256) return false
  if (bytesToHex(sha256(hexToBytes(orbitPubkeyHex))) !== orbitId.toLowerCase()) return false
  try {
    return ed25519.verify(hexToBytes(sigHex), enc.encode(`${PEER_BINDING_DOMAIN}|${peerId}|${orbitId}`), hexToBytes(orbitPubkeyHex))
  } catch {
    return false
  }
}

function isEnvelopeShape(e) {
  return (
    typeof e === 'object' && e !== null &&
    e.v === 2 &&
    typeof e.kind === 'string' && typeof e.to === 'string' &&
    typeof e.id === 'string' && typeof e.sealed === 'string'
  )
}

export function encodeFrame(binding, envelope) {
  const text = JSON.stringify({ binding, envelope })
  if (enc.encode(text).length > FRAME_MAX_BYTES) throw new Error('frame over cap')
  return text
}

export function decodeFrame(text) {
  if (typeof text !== 'string' || enc.encode(text).length > FRAME_MAX_BYTES) throw new Error('frame over cap')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('frame is not JSON')
  }
  if (!verifyPeerBinding(parsed?.binding)) throw new Error('bad binding')
  if (!isEnvelopeShape(parsed?.envelope)) throw new Error('bad envelope shape')
  return parsed
}

// Registers the inbound handler. onFrame({ binding, envelope, peerId, transport }).
// Invalid first frames are dropped + counted; the stream always closes.
export async function registerGmatchProtocol(node, { onFrame, onDrop = () => {} } = {}) {
  await node.handle(GMATCH_PROTOCOL, (stream, connection) => {
    const peerId = connection?.remotePeer?.toString?.() ?? 'unknown'
    const transport = connection?.remoteAddr?.toString?.() ?? 'unknown'
    let settled = false
    const done = (fn) => { if (!settled) { settled = true; try { fn() } catch {} } try { stream.close() } catch {} }
    const timer = setTimeout(() => done(() => onDrop({ peerId, reason: 'timeout' })), 15000)
    stream.addEventListener('message', (evt) => {
      clearTimeout(timer)
      let text
      try {
        text = typeof evt.data === 'string' ? evt.data : dec.decode(evt.data.subarray())
      } catch {
        done(() => onDrop({ peerId, reason: 'undecodable' }))
        return
      }
      done(() => {
        let frame
        try {
          frame = decodeFrame(text)
        } catch (err) {
          onDrop({ peerId, reason: err.message })
          return
        }
        onFrame({ binding: frame.binding, envelope: frame.envelope, peerId, transport })
      })
    })
    stream.addEventListener('close', () => { clearTimeout(timer); done(() => onDrop({ peerId, reason: 'empty' })) })
  })
}

export async function sendFrame(node, peer, binding, envelope, signal) {
  // dialProtocol takes PeerId | Multiaddr, not strings: invitation multiaddrs
  // are coerced; bare PeerIds resolve via the peer store (or fail closed).
  const target = typeof peer === 'string' && peer.startsWith('/') ? multiaddr(peer) : peer
  const stream = await node.dialProtocol(target, GMATCH_PROTOCOL, { signal })
  try {
    await stream.send(enc.encode(encodeFrame(binding, envelope)))
  } finally {
    try { stream.close() } catch {}
  }
}
