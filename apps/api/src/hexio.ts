/**
 * Shared hex helpers for the API (three modules re-implemented these).
 * Node has Buffer.from(hex,'hex') but the D1/crypto surfaces here all speak
 * Uint8Array — keep one hand-rolled pair so no module depends on Buffer.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}