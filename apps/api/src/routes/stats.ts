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

// (POST /referral removed — privacy refactor: no referrer collection.)

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
