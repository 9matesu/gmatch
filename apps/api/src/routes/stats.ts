import { Hono } from 'hono'
import type { D1Turso } from '../db'
import type { LocalBlobStore } from '../blob'
import crypto from 'crypto'

type Bindings = {
  DB: D1Turso
  BUCKET?: LocalBlobStore
}

export const stats = new Hono<{ Bindings: Bindings }>()

stats.get('/daily', async (c) => {
  let days = 14
  try {
    const q = c.req.query('days')
    if (q) days = Math.min(Math.max(1, parseInt(q, 10) || 14), 90)
  } catch {}

  const { results } = await c.env.DB.prepare(
    `SELECT date, active_users, matches_played, peak_concurrent, new_users, banned_users, reports_opened
     FROM DailyStats
     ORDER BY date DESC
     LIMIT ?`
  ).bind(days).all()

  return c.json(results || [])
})

// Inbound traffic-source attribution. The web client reports where it came
// from (document.referrer / ?ref= / utm_source) once per browser, keyed by a
// visitor key so repeat loads never inflate acquisition counts.
stats.post('/referral', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 80) : ''
  if (!source) return c.json({ ok: false }, 400)
  const visitorKey = typeof body.visitor_key === 'string' && body.visitor_key.length > 0 ? body.visitor_key.slice(0, 128) : null
  const referrerUrl = typeof body.referrer_url === 'string' ? body.referrer_url.slice(0, 500) : null
  const landingPath = typeof body.landing_path === 'string' ? body.landing_path.slice(0, 200) : null

  if (visitorKey) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM TrafficSources WHERE visitor_key = ? AND source = ?').bind(visitorKey, source).first()
    if (exists) return c.json({ ok: true, recorded: false })
    await c.env.DB.prepare('INSERT OR IGNORE INTO TrafficSources (id, visitor_key, source, referrer_url, landing_path) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), visitorKey, source, referrerUrl, landingPath).run()
  }
  return c.json({ ok: true, recorded: true })
})

// Live counters composed from cheap aggregate queries — exposed read-only.
stats.get('/live', async (c) => {
  const db = c.env.DB
  const now = Date.now()
  const fiveMinAgoIso = new Date(now - 5 * 60_000).toISOString()

  const activeUsers = await db.prepare(
    `SELECT COUNT(*) as n FROM Users WHERE last_seen >= ?`
  ).bind(fiveMinAgoIso).first<{ n: number }>()

  const totalUsers = await db.prepare(
    `SELECT COUNT(*) as n FROM Users`
  ).first<{ n: number }>()

  const matchesToday = await db.prepare(
    `SELECT COUNT(*) as n FROM GameMatches WHERE DATE(created_at) = DATE('now')`
  ).first<{ n: number }>()

  const openReports = await db.prepare(
    `SELECT COUNT(*) as n FROM ContentReports WHERE status = 'open'`
  ).first<{ n: number }>()

  const queuedPlayers = await db.prepare(
    `SELECT COUNT(*) as n FROM LobbyPlayers WHERE status = 'waiting'`
  ).first<{ n: number }>()

  return c.json({
    timestamp: new Date(now).toISOString(),
    active_users_5m: Number(activeUsers?.n ?? 0),
    total_users: Number(totalUsers?.n ?? 0),
    matches_today: Number(matchesToday?.n ?? 0),
    open_reports: Number(openReports?.n ?? 0),
    queued_players: Number(queuedPlayers?.n ?? 0),
  })
})
