export type UserErrorContext = {
  fallback?: string
  status?: number
}

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.'

/** Convert transport/domain failures into messages safe to show in the UI. */
export function userFacingError(error: unknown, context: UserErrorContext = {}): string {
  const status = context.status ?? (error && typeof error === 'object' && 'status' in error
    ? Number((error as { status?: number }).status)
    : 0)

  if (status === 401) return 'Please sign in again and try again.'
  if (status === 403) return 'You are not allowed to do that.'
  if (status === 404) return 'That content is no longer available.'
  if (status === 409) return 'That action is no longer available. Please refresh and try again.'
  if (status === 429) return 'You are doing that too quickly. Please try again shortly.'
  if (status === 503 || status === 0) return 'The service is unavailable. Please try again shortly.'
  return context.fallback || DEFAULT_MESSAGE
}

export function userFacingResponse(response: Response, fallback?: string): string {
  return userFacingError({ status: response.status }, { status: response.status, fallback })
}
