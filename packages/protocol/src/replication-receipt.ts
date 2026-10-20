import { signMessage, verifySignature, bytesToHex, hexToBytes } from '@orbit/crypto'
import { stableStringify } from '@orbit/shared'
import { sha256Hex } from './hash'

/**
 * Replication receipt (protocol proposal v1, roadmap L2).
 *
 * A receipt is the ONLY acceptable evidence that another node durably holds an
 * object: it is signed by the receiving node AFTER it verified the assembled
 * bytes against the manifest/CID AND read them back from its durable store.
 * A `SWARM_HAVE` message, a successful sender-side write, or a relay ack is
 * never a receipt.
 *
 * Replay protection: the requester mints a fresh `challenge` nonce per
 * transfer and only accepts a receipt whose challenge matches its outstanding
 * nonce; `validateReplicationReceipt` additionally enforces a wall-clock
 * freshness window as a backstop. The challenge binding means a replayed
 * receipt from an earlier transfer fails the requester's own nonce check even
 * within the window.
 */

export const RECEIPT_PROTOCOL = 'gmatch-social'
export const RECEIPT_VERSION = 1
const RECEIPT_SIG_DOMAIN = `${RECEIPT_PROTOCOL}|${RECEIPT_VERSION}|receipt|`
/** Backstop freshness window; the per-transfer challenge is the real guard. */
export const MAX_RECEIPT_AGE_MS = 5 * 60_000
/** Forward clock-skew allowance so honest peers with drifting clocks work. */
export const RECEIPT_SKEW_MS = 30_000

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

export interface ReplicationReceipt {
  protocol: typeof RECEIPT_PROTOCOL
  version: typeof RECEIPT_VERSION
  receiverId: string
  receiverKey: string
  objectCid: string
  manifestHash: string
  /** True only after the bytes were read back from the receiver's durable store. */
  durable: boolean
  /** Fresh per-transfer nonce minted by the requester (replay binding). */
  challenge: string
  createdAt: number
  signature: string
}

export type UnsignedReceipt = Omit<ReplicationReceipt, 'signature'>

function receiptPreimage(receipt: UnsignedReceipt): Uint8Array {
  return new TextEncoder().encode(RECEIPT_SIG_DOMAIN + stableStringify(receipt))
}

export function createReplicationReceipt(
  receipt: UnsignedReceipt,
  privateKeyHex: string,
): ReplicationReceipt {
  const signature = bytesToHex(signMessage(receiptPreimage(receipt), privateKeyHex))
  const signed = { ...receipt, signature }
  // Creation self-check: everything except wall-clock freshness, which by
  // definition holds at createdAt (the timestamp we just stamped).
  const error = validateReplicationReceipt(signed, receipt.createdAt)
  if (error) throw new Error(error)
  return signed
}

export function validateReplicationReceipt(
  value: unknown,
  now: number = Date.now(),
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'receipt must be an object'
  const receipt = value as Record<string, unknown>
  const fields = ['protocol', 'version', 'receiverId', 'receiverKey', 'objectCid', 'manifestHash', 'durable', 'challenge', 'createdAt', 'signature']
  if (Object.keys(receipt).some((key) => !fields.includes(key))) return 'unknown receipt field'
  if (receipt.protocol !== RECEIPT_PROTOCOL || receipt.version !== RECEIPT_VERSION) return 'unsupported receipt version'
  for (const field of ['receiverId', 'receiverKey', 'objectCid', 'manifestHash', 'challenge'] as const) {
    if (typeof receipt[field] !== 'string' || !HEX64.test(receipt[field] as string)) return `invalid ${field}`
  }
  if (typeof receipt.durable !== 'boolean') return 'invalid durable flag'
  if (!Number.isSafeInteger(receipt.createdAt) || (receipt.createdAt as number) < 0) return 'invalid creation time'
  if (typeof receipt.signature !== 'string' || !HEX128.test(receipt.signature)) return 'invalid signature'
  try {
    // Identity binding: the receiver's claimed id must derive from its key.
    if (sha256Hex(hexToBytes(receipt.receiverKey as string)) !== receipt.receiverId) return 'receiver id does not match key'
    // A receipt that did not survive a durable read-back is not evidence.
    if (receipt.durable !== true) return 'receipt is not durable'
    // Freshness backstop (the per-transfer challenge is the primary guard).
    // Asymmetric window: full age backwards, small skew forwards — a receiver
    // cannot extend its receipt's life by future-dating it.
    const age = now - (receipt.createdAt as number)
    if (age > MAX_RECEIPT_AGE_MS || age < -RECEIPT_SKEW_MS) return 'receipt is stale'
    const { signature: _signature, ...unsigned } = receipt as unknown as ReplicationReceipt
    if (!verifySignature(hexToBytes(receipt.signature as string), receiptPreimage(unsigned as UnsignedReceipt), receipt.receiverKey as string)) {
      return 'invalid receipt signature'
    }
  } catch {
    return 'invalid receipt encoding'
  }
  return null
}
