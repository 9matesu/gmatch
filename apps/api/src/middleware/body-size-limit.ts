import { Context, Next } from 'hono'

const MAX_BODY_SIZE = 1_048_576 // 1MB
const MAX_MULTIPART_SIZE = 104_857_600 // 100MB for file uploads

export async function bodySizeLimit(c: Context, next: Next) {
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10)
  const contentType = c.req.header('Content-Type') || ''
  const isMultipart = contentType.includes('multipart/')

  const maxSize = isMultipart ? MAX_MULTIPART_SIZE : MAX_BODY_SIZE

  if (contentLength > maxSize) {
    return c.json({
      error: 'Request body too large',
      limit: maxSize,
    }, 413)
  }

  await next()
}
