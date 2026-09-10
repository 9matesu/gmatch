import { readFileSync, writeFileSync } from 'node:fs'
import { bytesToHex, hexToBytes } from './hexio'
import { x25519 } from '@noble/curves/ed25519.js'

/**
 * Node transport keypair (security plan T2): the X25519 key sealed API
 * requests are encrypted to. Generated once per data dir and persisted next
 * to the snapshot (same pattern as storage-key.ts). Only the PUBLIC half ever
 * leaves the machine (GET /api/identity).
 */
function isUsableKey(hex: string | undefined | null): boolean {
  return /^[0-9a-f]{64}$/i.test(hex || '')
}

export function resolveNodeKey(snapshotPath: string, env: Record<string, string | undefined> = process.env): { privHex: string; pubHex: string } {
  const fromEnv = env.NODE_PRIVATE_HEX
  if (isUsableKey(fromEnv)) return derive(fromEnv as string)
  const keyPath = joinLike(snapshotPath, 'node.key')
  try {
    const stored = readFileSync(keyPath, 'utf8').trim()
    if (isUsableKey(stored)) return derive(stored)
  } catch {
    /* generate below */
  }
  const priv = bytesToHex(x25519.utils.randomPrivateKey())
  try {
    writeFileSync(keyPath, priv)
  } catch {
    /* ephemeral: sealed requests still work within the session */
  }
  return derive(priv)
}

function derive(privHex: string) {
  const pub = x25519.getPublicKey(hexToBytes(privHex))
  return { privHex, pubHex: bytesToHex(pub) }
}

function joinLike(snapshotPath: string, file: string): string {
  const idx = Math.max(snapshotPath.lastIndexOf('/'), snapshotPath.lastIndexOf('\\'))
  return idx > 0 ? snapshotPath.slice(0, idx) + '/' + file : file
}

