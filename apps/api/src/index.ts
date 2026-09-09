import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './routes/auth'
import { mail } from './routes/mail'
import { turn } from './routes/turn'
import { servers } from './routes/servers'
import { securityHeaders } from './middleware/security-headers'
import { rateLimit } from './middleware/rate-limit'
import { bodySizeLimit } from './middleware/body-size-limit'
import type { D1Turso } from './db'
import type { LocalBlobStore } from './blob'
import crypto from 'crypto'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

const app = new Hono<{ Bindings: Bindings, Variables: { requestId: string } }>()

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-ID', requestId)
  await next()
})

app.onError((err, c) => {
  console.error(`[global] [${c.get('requestId') || 'unknown'}] Unhandled error:`, err.stack || err.message || err)
  const reqOrigin = c.req.header('Origin') || '*'
  return c.json({ error: 'Internal server error' }, 500, {
    'Access-Control-Allow-Origin': reqOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  })
})

app.use('*', cors({
  origin: '*',
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Orbit-Id',
    'X-Orbit-Timestamp',
    'X-Orbit-Signature',
    'X-Orbit-PubKey',
    'X-Orbit-PubKey-Enc',
    'X-Orbit-Nonce',
    'x-orbit-id',
    'x-orbit-timestamp',
    'x-orbit-signature',
    'x-orbit-pubkey',
    'x-orbit-pubkey-enc',
    'x-orbit-nonce',
    'X-Request-ID',
    'Idempotency-Key',
    'X-Idempotency-Key',
    'X-Orbit-Sealed',
  ],
  allowMethods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],
  exposeHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
    'X-Request-ID',
  ],
}))

app.use('*', securityHeaders)
app.use('*', bodySizeLimit)
import { unsealRequest } from './middleware/unseal'
app.use('*', unsealRequest)

app.get('/api/health', rateLimit, (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Public Discord invite link (admin-managed via SystemMeta). No auth: the web
// header needs this pre-login. Empty stored value disables the JOIN button.
app.get('/api/discord-invite', rateLimit, async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT value FROM SystemMeta WHERE key = 'discord_invite_url'").bind().first() as { value: string } | null
    return c.json({ url: row?.value || null })
  } catch {
    return c.json({ url: null })
  }
})

// Node identity (security plan T2): public half of the node X25519 transport
// key. Clients cache this and seal mutation bodies to it (X-Orbit-Sealed).
// No auth, no user data — a static-ish capability advertisement.
app.get('/api/identity', (c) => {
  const pubHex = (c.env as { NODE_PUB_HEX?: string })?.NODE_PUB_HEX || null
  return c.json({
    server_pubkey: pubHex,
    sealed_available: !!pubHex,
    sealed_required: !!(c.env as { API_SEALED_ONLY?: string })?.API_SEALED_ONLY,
  })
})

app.get('/.well-known/security.txt', (c) => {
  const securityTxt = `Contact: mailto:security@goonmatch.app
Expires: 2027-12-31T23:59:59.000Z
Preferred-Languages: en
Canonical: https://goonmatch.fly.dev/.well-known/security.txt
Policy: https://goonmatch.fly.dev/docs/SECURITY.md
`
  return c.text(securityTxt, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
})

import { objects } from './routes/objects'
import { friends } from './routes/friends'
import { inbox } from './routes/inbox'
import { users } from './routes/users'
import { og } from './routes/og'
import { admin, announcements } from './routes/admin'
import { signal } from './routes/signal'
import { recommendations } from './routes/recommendations'
import { likes } from './routes/likes'
import { lobby, wsTicket } from './routes/lobby'
import { rooms } from './routes/rooms'
import { flash } from './routes/flash'
import { babecock } from './routes/babecock'
import { pm } from './routes/pm'
import { stats } from './routes/stats'
import { notifications, matchInvites } from './routes/notifications'
import { posts } from './routes/posts'
import { booru } from './routes/booru'
import { moderation } from './routes/moderation'
import { starterDeck } from './routes/starter-deck'
import { economy } from './routes/economy'
import { economyIdle } from './routes/economy-idle'
import { cards } from './routes/cards'
import { decks } from './routes/decks'
import { slideshows } from './routes/slideshows'
import { groups } from './routes/groups'
import domination from './routes/domination'
import { reportRouter } from './routes/reports'

// Rate limiting applied to all API routes
app.use('/api/*', rateLimit)
app.use('/.well-known/*', rateLimit)

app.route('/api/auth', auth)
app.route('/api/mail', mail)
app.route('/api/turn', turn)
app.route('/api/servers', servers)
app.route('/api/objects', objects)
app.route('/api/stories', objects)
app.route('/api/friends', friends)
app.route('/api/inbox', inbox)
app.route('/api/users', users)
app.route('/api/og', og)
app.route('/api/admin', admin)
app.route('/api/admin/settings/starter-cards', starterDeck)
app.route('/api/starter-deck', starterDeck)
app.route('/api/announcements', announcements)
app.route('/api/signal', signal)
app.route('/api/recommendations', recommendations)
app.route('/api/likes', likes)
app.route('/api/relationships', likes)
app.route('/api/lobby', lobby)
app.route('/api/ws-ticket', wsTicket)
app.route('/api/rooms', rooms)
app.route('/api/flash', flash)
app.route('/api/babecock', babecock)
app.route('/api/pm', pm)
app.route('/api/stats', stats)
app.route('/api/notifications', notifications)
app.route('/api/lobby/invites', matchInvites)
app.route('/api/posts', posts)
app.route('/api/booru', booru)
app.route('/api/moderation', moderation)
app.route('/api/economy', economy)
app.route('/api/economy', economyIdle)
app.route('/api/cards', cards)
app.route('/api/decks', decks)
app.route('/api/slideshows', slideshows)
app.route('/api/groups', groups)
app.route('/api/domination', domination)
app.route('/api/report', reportRouter)

// Public share pages (no /api prefix — mounted on the app root too).
import { share } from './routes/share'
app.route('/', share)

import { handleWebSocketUpgrade } from './routes/ws'

// Intercept WebSocket upgrades before standard middleware (CF Workers only)
if (typeof (globalThis as any).WebSocketPair !== 'undefined') {
  app.use('/api/ws', async (c, next) => {
    const response = await handleWebSocketUpgrade(c.req.raw)
    if (response) return response
    return next()
  })
}

export default app
