// Typed domain errors shared across services. Each maps to a stable HTTP status
// and a single user-facing message so route handlers never hand-roll error JSON.
// Messages are safe to return to clients: they never leak SQL, stack traces,
// or internal identifiers beyond what a caller already knows.

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_FUNDS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'INTERNAL'

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_FUNDS: 400,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE: 409,
  INTERNAL: 500,
}

export class DomainError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.status = HTTP_STATUS[code]
    this.details = details
  }
}

export function badRequest(message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError('BAD_REQUEST', message, details)
}

export function unauthorized(message = 'Not authenticated'): DomainError {
  return new DomainError('UNAUTHORIZED', message)
}

export function forbidden(message = 'Not authorized'): DomainError {
  return new DomainError('FORBIDDEN', message)
}

export function notFound(message = 'Not found'): DomainError {
  return new DomainError('NOT_FOUND', message)
}

export function conflict(message: string): DomainError {
  return new DomainError('CONFLICT', message)
}

export function insufficientFunds(message = 'Insufficient funds'): DomainError {
  return new DomainError('INSUFFICIENT_FUNDS', message)
}

export function idempotencyConflict(message = 'Idempotency key reused with different parameters'): DomainError {
  return new DomainError('IDEMPOTENCY_CONFLICT', message)
}

export function invalidState(message: string): DomainError {
  return new DomainError('INVALID_STATE', message)
}

// `cause` is intentionally omitted from the client response but preserved on the
// error object so server logs keep the real failure.
export function internal(message = 'Internal server error', cause?: unknown): DomainError {
  const err = new DomainError('INTERNAL', message)
  ;(err as unknown as { cause?: unknown }).cause = cause
  return err
}

// Convert any thrown value into a DomainError (wrapping unexpected errors as
// INTERNAL) so route handlers have one consistent shape to respond with.
// The original message is NEVER surfaced to clients — it may contain SQL,
// constraint names, or filesystem details. It is preserved as `cause` for logs.
export function toDomainError(err: unknown): DomainError {
  if (err instanceof DomainError) return err
  return internal('Internal server error', err)
}
