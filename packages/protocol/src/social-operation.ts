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
const OPERATION_TYPES = new Set([
  'post.create', 'post.edit', 'post.delete',
  'comment.create', 'comment.delete', 'reaction.add', 'reaction.remove',
])

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

export interface VerifiedSocialManifest {
  ownerId: string
  contentCid: string
  mimeType: string
  sizeBytes: number
}

export interface SocialAuthorizationContext {
  /** Must contain only manifests whose signature and CID were already checked. */
  verifiedManifests: ReadonlyMap<string, VerifiedSocialManifest>
  /**
   * The caller guarantees the accepted history was ALREADY validated when it
   * was ingested (the transport validates every operation before it appends
   * it, so the log only ever holds valid operations).
   *
   * Without this flag the authorizer re-validates the entire history on every
   * call — one signature verification per retained entry, PER OPERATION. A
   * 512-operation replication wave did ~131k Ed25519 verifications that way
   * (O(n²)); with the flag only the operation under authorization is
   * verified, and the cheap structural checks (equivocation, predecessor
   * binding) still run.
   */
  trustedHistory?: boolean
}

type UnsignedOperation = Omit<SocialOperation, 'operationId' | 'signature'>

function operationIdPreimage(operation: UnsignedOperation): Uint8Array {
  return new TextEncoder().encode(OPERATION_ID_DOMAIN + stableStringify(operation))
}

function signaturePreimage(operation: Omit<SocialOperation, 'signature'>): Uint8Array {
  return new TextEncoder().encode(OPERATION_SIG_DOMAIN + stableStringify(operation))
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every((entry) => isJsonValue(entry, depth + 1))
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((entry) => isJsonValue(entry, depth + 1))
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function validText(value: unknown, maxLength: number, allowEmpty = false): boolean {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.length > 0)
}

function validHexId(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

function validObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value)
}

function validatePostPayload(payload: Record<string, unknown>, editing: boolean): boolean {
  const required = editing ? ['supersedes', 'contentCid', 'manifestHash', 'mimeType', 'sizeBytes']
    : ['contentCid', 'manifestHash', 'mimeType', 'sizeBytes']
  if (!hasOnlyKeys(payload, required, ['caption', 'tags'])) return false
  if (!validHexId(payload.contentCid) || !validHexId(payload.manifestHash)) return false
  if (!validText(payload.mimeType, 100) || !Number.isSafeInteger(payload.sizeBytes) || (payload.sizeBytes as number) < 1 || (payload.sizeBytes as number) > 64 * 1024 * 1024) return false
  if (Object.hasOwn(payload, 'caption') && !validText(payload.caption, 2000, true)) return false
  if (Object.hasOwn(payload, 'tags') && (!Array.isArray(payload.tags) || payload.tags.length > 5 || payload.tags.some((tag) => !validText(tag, 20)))) return false
  return !editing || (Array.isArray(payload.supersedes) && payload.supersedes.length > 0 && payload.supersedes.length <= 32 && payload.supersedes.every(validHexId))
}

function validateOperationPayload(type: string, payload: Record<string, unknown>): boolean {
  switch (type) {
    case 'post.create': return validatePostPayload(payload, false)
    case 'post.edit': return validatePostPayload(payload, true)
    case 'post.delete':
    case 'comment.delete':
      return hasOnlyKeys(payload, ['targetOperationId']) && validHexId(payload.targetOperationId)
    case 'comment.create':
      return hasOnlyKeys(payload, ['postId', 'parentCommentId', 'body']) &&
        validObjectId(payload.postId) &&
        (payload.parentCommentId === null || validObjectId(payload.parentCommentId)) &&
        validText(payload.body, 4000)
    case 'reaction.add':
      return hasOnlyKeys(payload, ['targetType', 'targetId', 'reaction']) &&
        (payload.targetType === 'post' || payload.targetType === 'comment') &&
        validObjectId(payload.targetId) && payload.reaction === 'like'
    case 'reaction.remove':
      return hasOnlyKeys(payload, ['targetAddOperationIds']) &&
        Array.isArray(payload.targetAddOperationIds) && payload.targetAddOperationIds.length > 0 &&
        payload.targetAddOperationIds.length <= 100 && payload.targetAddOperationIds.every(validHexId)
    default: return false
  }
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
  if (typeof op.type !== 'string' || !OPERATION_TYPES.has(op.type)) return 'unsupported operation type'
  if (typeof op.operationId !== 'string' || !HEX64.test(op.operationId)) return 'invalid operation id'
  if (typeof op.actorId !== 'string' || !HEX64.test(op.actorId)) return 'invalid actor id'
  if (typeof op.signingKey !== 'string' || !HEX64.test(op.signingKey)) return 'invalid signing key'
  if (!Number.isSafeInteger(op.actorSequence) || (op.actorSequence as number) < 1) return 'invalid actor sequence'
  if (op.previousOperationId !== null && (typeof op.previousOperationId !== 'string' || !HEX64.test(op.previousOperationId))) return 'invalid previous operation id'
  if ((op.actorSequence === 1) !== (op.previousOperationId === null)) return 'sequence and previous operation mismatch'
  if (!Number.isSafeInteger(op.createdAt) || (op.createdAt as number) < 0) return 'invalid creation time'
  if (!validObjectId(op.objectId)) return 'invalid object id'
  if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)) return 'payload must be an object'
  if (!isJsonValue(op.payload)) return 'payload must contain only bounded-depth JSON values'
  if (!validateOperationPayload(op.type as string, op.payload as Record<string, unknown>)) return 'invalid operation payload'
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

/**
 * Authorize one operation against an accepted, signature-verified history.
 * The history may be PARTIAL (pruned or partially synced): sequence gaps are
 * legal and detectable, but sequence reuse (equivocation) and a predecessor
 * reference that binds to the wrong entry are always rejected.
 */
export function authorizeSocialOperation(
  value: unknown,
  acceptedHistory: SocialOperation[],
  context: SocialAuthorizationContext = { verifiedManifests: new Map() },
): string | null {
  const malformed = validateSocialOperation(value)
  if (malformed) return malformed
  return authorizeValidatedOperation(value as SocialOperation, acceptedHistory, context)
}

/**
 * The same authorization WITHOUT re-validating the operation's signature.
 *
 * Callers that just validated (or created) the operation pay for exactly one
 * Ed25519 verification instead of two: the replication path used to verify
 * every operation twice per hop (validate + authorize), which was half of the
 * CPU cost of a replication wave. The history checks are unchanged.
 */
export function authorizeValidatedOperation(
  operation: SocialOperation,
  acceptedHistory: SocialOperation[],
  context: SocialAuthorizationContext = { verifiedManifests: new Map() },
): string | null {
  // Re-validating every retained entry is O(history) signature verifications
  // per operation. Callers that ingested the history through the validated
  // path opt out with `trustedHistory`; the default stays strict.
  if (!context.trustedHistory) {
    const historyError = acceptedHistory.find((entry) => validateSocialOperation(entry))
    if (historyError) return 'accepted history contains an invalid operation'
  }
  const historyIds = new Map(acceptedHistory.map((entry) => [entry.operationId, entry]))
  const actorSequences = new Set<string>()
  for (const entry of acceptedHistory) {
    const key = `${entry.actorId}:${entry.actorSequence}`
    if (actorSequences.has(key)) return 'accepted history contains actor equivocation'
    actorSequences.add(key)
    // Partial histories are legal (pruning, partial sync): a gap between
    // retained entries is allowed and detectable. What is NEVER allowed:
    // a predecessor reference that exists but binds to the wrong entry.
    if (entry.actorSequence > 1 && entry.previousOperationId) {
      const predecessor = historyIds.get(entry.previousOperationId)
      if (predecessor && (predecessor.actorId !== entry.actorId || predecessor.actorSequence !== entry.actorSequence - 1)) {
        return 'accepted history has a mismatched actor predecessor'
      }
    }
  }
  if (acceptedHistory.some((entry) => entry.operationId === operation.operationId)) return 'operation already accepted'
  if (acceptedHistory.some((entry) => entry.actorId === operation.actorId && entry.actorSequence === operation.actorSequence)) {
    return 'actor sequence already used; possible equivocation'
  }
  if (operation.actorSequence > 1 && !acceptedHistory.some((entry) =>
    entry.actorId === operation.actorId && entry.actorSequence === operation.actorSequence - 1 &&
    entry.operationId === operation.previousOperationId)) return 'actor predecessor is missing or mismatched'

  const byId = (id: unknown) => acceptedHistory.find((entry) => entry.operationId === id)
  const postCreate = (id: string) => acceptedHistory.find((entry) => entry.type === 'post.create' && entry.objectId === id)
  const commentCreate = (id: string) => acceptedHistory.find((entry) => entry.type === 'comment.create' && entry.objectId === id)
  const postIsDeleted = (post: SocialOperation) => acceptedHistory.some((entry) =>
    entry.type === 'post.delete' && (entry.payload as { targetOperationId: string }).targetOperationId === post.operationId)
  const commentIsDeleted = (comment: SocialOperation) => acceptedHistory.some((entry) =>
    entry.type === 'comment.delete' && (entry.payload as { targetOperationId: string }).targetOperationId === comment.operationId)
  const manifestMatches = () => {
    const manifest = context.verifiedManifests.get(operation.payload.manifestHash as string)
    return !!manifest && manifest.ownerId === operation.actorId &&
      manifest.contentCid === operation.payload.contentCid &&
      manifest.mimeType === operation.payload.mimeType && manifest.sizeBytes === operation.payload.sizeBytes
  }

  if (operation.type === 'post.create') {
    if (postCreate(operation.objectId)) return 'post already created'
    return manifestMatches() ? null : 'verified author manifest is required'
  }
  if (operation.type === 'post.edit' || operation.type === 'post.delete') {
    const post = postCreate(operation.objectId)
    if (!post) return 'post does not exist'
    if (post.actorId !== operation.actorId) return 'only the post author may mutate it'
    if (postIsDeleted(post)) return 'post is tombstoned'
    if (operation.type === 'post.delete') {
      return operation.payload.targetOperationId === post.operationId ? null : 'delete target does not match post'
    }
    if (!manifestMatches()) return 'verified author manifest is required'
    const heads = acceptedHistory
      .filter((entry) => entry.objectId === post.objectId && (entry.type === 'post.create' || entry.type === 'post.edit'))
      .filter((entry) => !acceptedHistory.some((candidate) =>
        candidate.type === 'post.edit' &&
        (candidate.payload as { supersedes: string[] }).supersedes.includes(entry.operationId)))
      .map((entry) => entry.operationId)
      .sort()
    const supersedes = [...operation.payload.supersedes as string[]].sort()
    return supersedes.length === heads.length && supersedes.every((id, i) => id === heads[i])
      ? null
      : 'edit must supersede exactly the current post heads'
  }
  if (operation.type === 'comment.create') {
    const post = postCreate(operation.payload.postId as string)
    if (!post || postIsDeleted(post)) return 'comment target post is unavailable'
    const parentId = operation.payload.parentCommentId
    if (parentId !== null) {
      const parent = commentCreate(parentId as string)
      if (!parent || parent.payload.postId !== post.objectId || commentIsDeleted(parent)) return 'comment parent is unavailable'
    }
    return commentCreate(operation.objectId) ? 'comment already created' : null
  }
  if (operation.type === 'comment.delete') {
    const comment = byId(operation.payload.targetOperationId)
    if (!comment || comment.type !== 'comment.create' || comment.objectId !== operation.objectId) return 'delete target does not match comment'
    if (comment.actorId !== operation.actorId) return 'only the comment author may delete it'
    return commentIsDeleted(comment) ? 'comment is already tombstoned' : null
  }
  if (operation.type === 'reaction.add') {
    const targetType = operation.payload.targetType
    const targetId = operation.payload.targetId as string
    const target = targetType === 'post' ? postCreate(targetId) : commentCreate(targetId)
    if (!target || (targetType === 'post' ? postIsDeleted(target) : commentIsDeleted(target))) return 'reaction target is unavailable'
    const removed = new Set(acceptedHistory.filter((entry) => entry.type === 'reaction.remove')
      .flatMap((entry) => entry.payload.targetAddOperationIds as string[]))
    const active = acceptedHistory.some((entry) => entry.type === 'reaction.add' &&
      entry.actorId === operation.actorId && entry.payload.targetType === targetType &&
      entry.payload.targetId === targetId && !removed.has(entry.operationId))
    return active ? 'actor already has an active like' : null
  }
  const adds = operation.payload.targetAddOperationIds as string[]
  const first = byId(adds[0])
  if (!first || first.type !== 'reaction.add' || first.actorId !== operation.actorId) return 'reaction removal is not owned by actor'
  const targetType = first.payload.targetType
  const targetId = first.payload.targetId
  for (const id of adds) {
    const add = byId(id)
    if (!add || add.type !== 'reaction.add' || add.actorId !== operation.actorId ||
        add.payload.targetType !== targetType || add.payload.targetId !== targetId) {
      return 'reaction removal must reference only the actor’s adds for one target'
    }
  }
  if (acceptedHistory.some((entry) => entry.type === 'reaction.remove' &&
      (entry.payload.targetAddOperationIds as string[]).some((id) => adds.includes(id)))) {
    return 'reaction add already removed'
  }
  return null
}
