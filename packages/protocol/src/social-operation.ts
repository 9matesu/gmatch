import { signMessage, verifySignature, bytesToHex, hexToBytes } from '@orbit/crypto'
import { stableStringify } from '@orbit/shared'
import { sha256Hex } from './hash'

export const SOCIAL_PROTOCOL = 'gmatch-social'
export const SOCIAL_PROTOCOL_VERSION = 1
const OPERATION_ID_DOMAIN = `${SOCIAL_PROTOCOL}|${SOCIAL_PROTOCOL_VERSION}|operation-id|`
const OPERATION_SIG_DOMAIN = `${SOCIAL_PROTOCOL}|${SOCIAL_PROTOCOL_VERSION}|operation|`
const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const MAX_PAYLOAD_BYTES = 32 * 1024

export interface SocialOperation {
  protocol: typeof SOCIAL_PROTOCOL
  version: typeof SOCIAL_PROTOCOL_VERSION
  type: string
  operationId: string
  actorId: string
  signingKey: string
  actorSequence: number
  previousOperationId: string | null
  createdAt: number
  objectId: string
  payload: Record<string, unknown>
  signature: string
}

type UnsignedOperation = Omit<SocialOperation, 'operationId' | 'signature'>

function operationIdPreimage(operation: UnsignedOperation): Uint8Array {
  return new TextEncoder().encode(OPERATION_ID_DOMAIN + stableStringify(operation))
}

function signaturePreimage(operation: Omit<SocialOperation, 'signature'>): Uint8Array {
  return new TextEncoder().encode(OPERATION_SIG_DOMAIN + stableStringify(operation))
}

export function createSocialOperation(
  operation: UnsignedOperation,
  privateKeyHex: string,
): SocialOperation {
  const operationId = sha256Hex(operationIdPreimage(operation))
  const unsigned = { ...operation, operationId }
  const signature = bytesToHex(signMessage(signaturePreimage(unsigned), privateKeyHex))
  const signed = { ...unsigned, signature }
  const error = validateSocialOperation(signed)
  if (error) throw new Error(error)
  return signed
}

export function validateSocialOperation(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'operation must be an object'
  const op = value as Record<string, unknown>
  const fields = ['protocol', 'version', 'type', 'operationId', 'actorId', 'signingKey', 'actorSequence', 'previousOperationId', 'createdAt', 'objectId', 'payload', 'signature']
  if (Object.keys(op).some((key) => !fields.includes(key))) return 'unknown operation field'
  if (op.protocol !== SOCIAL_PROTOCOL || op.version !== SOCIAL_PROTOCOL_VERSION) return 'unsupported protocol version'
  if (typeof op.type !== 'string' || !/^[a-z][a-z0-9.]{1,63}$/.test(op.type)) return 'invalid operation type'
  if (typeof op.operationId !== 'string' || !HEX64.test(op.operationId)) return 'invalid operation id'
  if (typeof op.actorId !== 'string' || !HEX64.test(op.actorId)) return 'invalid actor id'
  if (typeof op.signingKey !== 'string' || !HEX64.test(op.signingKey)) return 'invalid signing key'
  if (!Number.isSafeInteger(op.actorSequence) || (op.actorSequence as number) < 1) return 'invalid actor sequence'
  if (op.previousOperationId !== null && (typeof op.previousOperationId !== 'string' || !HEX64.test(op.previousOperationId))) return 'invalid previous operation id'
  if ((op.actorSequence === 1) !== (op.previousOperationId === null)) return 'sequence and previous operation mismatch'
  if (!Number.isSafeInteger(op.createdAt) || (op.createdAt as number) < 0) return 'invalid creation time'
  if (typeof op.objectId !== 'string' || op.objectId.length < 1 || op.objectId.length > 256) return 'invalid object id'
  if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)) return 'payload must be an object'
  if (typeof op.signature !== 'string' || !HEX128.test(op.signature)) return 'invalid signature'
  try {
    if (new TextEncoder().encode(stableStringify(op.payload)).byteLength > MAX_PAYLOAD_BYTES) return 'payload too large'
    if (sha256Hex(hexToBytes(op.signingKey)) !== op.actorId) return 'actor id does not match signing key'
    const { signature: _signature, ...signedFields } = op as unknown as SocialOperation
    const { operationId, ...base } = signedFields
    if (sha256Hex(operationIdPreimage(base)) !== operationId) return 'operation id mismatch'
    if (!verifySignature(hexToBytes(op.signature), signaturePreimage(signedFields), op.signingKey)) return 'invalid signature'
  } catch {
    return 'invalid operation encoding'
  }
  return null
}
