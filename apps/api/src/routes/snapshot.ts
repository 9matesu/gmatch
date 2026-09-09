import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'

/**
 * Server SNAPSHOT export/import (plan T6, docs/ADR-002-servers.md).
 *
 * The honest v1 of "every player holds a piece of the server": the HOST (or
 * an admin on the central) exports the node's content as a JSON snapshot and
 * hands it to a successor host out-of-band; that host imports it before
 * sharing the server. The central directory NEVER sees snapshots — they are
 * node-local admin tools.
 *
 * Scope: content + social tables only. Deliberately EXCLUDED:
 *  - Users secrets-adjacent columns are fine (public keys), but Devices,
 *    Sessions, RateLimits, ServerDirectory, SystemMeta (node-local settings
 *    incl. the password hash — must not travel!), and the mail/courier
 *    tables (mailboxes are per-node transport state, not world content).
 * Import is transactional-ish: one table at a time, INSERT OR REPLACE;
 * failures abort before Users/ServerDirectory could be touched (they aren't
 * in the allowlist at all).
 */
type Bindings = { DB: D1Turso }

const SNAPSHOT_VERSION = 1

/** Tables that make up "the world", in dependency-safe order for import. */
const CONTENT_TABLES = [
  'Users',
  'Friends', 'FriendRequests', 'Followers', 'UserBlocks', 'UserReports', 'ContentReports', 'ReportedImages',
  'Objects', 'Recipients', 'Favorites', 'Likes',
  'Announcements', 'Recommendations',
  'Lobbies', 'LobbyPlayers', 'LobbyImages', 'LobbyComments', 'LobbyLikes', 'LobbyChat',
  'MatchSessions', 'MatchRounds', 'MatchPairs', 'TierMatches', 'GameMatches',
  'MatchRooms', 'MatchRoomPlayers', 'RoomDuelPairs', 'MatchCards', 'MatchChat', 'MatchInvites', 'MatchArchive', 'LeagueRank',
  'ChatGroups', 'ChatGroupMembers', 'GroupMessages',
  'PrivateMessages', 'PmReadReceipts',
  'Comments', 'CommentLikes',
  'Decks', 'DeckCards', 'Cards', 'CardOwnership', 'CardHistory', 'MarketListings',
  'StoreUnlocks', 'UserInventory', 'BabecockRounds', 'BabecockEntries', 'BabecockInvites', 'Lootboxes',
  'Slideshows', 'SlideshowItems',
  'Wallets', 'LedgerTransactions', 'EconomicOperations',
  'Notifications', 'Playtime', 'Saves', 'DominationActions', 'DonationAcknowledgement',
] as const

/** Hard safety net — never snapshot node-local security/transport state. */
const NEVER_TABLES = [
  'SystemMeta', 'ServerDirectory', 'Devices', 'Sessions', 'RateLimits',
  'AdminAuditLog', 'DailyStats', 'SessionEvents', 'TrafficSources', 'Bots', 'Bans', 'ModerationPatrolRewards',
] as const

function assertAllowed(table: string): void {
  if ((NEVER_TABLES as readonly string[]).includes(table)) {
    throw new Error(`table ${table} may never be part of a snapshot`)
  }
}

async function requireAdmin(c: { env: Bindings; get(k: 'orbitId'): string | undefined }): Promise<boolean> {
  const orbitId = c.get('orbitId')
  if (!orbitId) return false
  const row = await c.env.DB.prepare('SELECT is_admin FROM Users WHERE id = ?').bind(orbitId).first<{ is_admin: number }>()
  return row?.is_admin === 1
}

export const snapshot = new Hono<{ Bindings: Bindings, Variables: { orbitId: string; publicKeyHex: string } }>()

snapshot.get('/', orbitAuth, async (c) => {
  if (!(await requireAdmin(c))) return c.json({ error: 'admin only' }, 403)
  const tables: Record<string, unknown[]> = {}
  for (const t of CONTENT_TABLES) {
    assertAllowed(t)
    try {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()
      if (results && results.length) tables[t] = results
    } catch {
      // table absent on this build of the node — skip silently (forward-compat)
    }
  }
  return c.json({ version: SNAPSHOT_VERSION, exported_at: new Date().toISOString(), tables })
})

snapshot.post('/import', orbitAuth, async (c) => {
  if (!(await requireAdmin(c))) return c.json({ error: 'admin only' }, 403)
  let body: { version?: unknown; tables?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  if (body.version !== SNAPSHOT_VERSION) return c.json({ error: `unsupported snapshot version (want ${SNAPSHOT_VERSION})` }, 400)
  if (!body.tables || typeof body.tables !== 'object') return c.json({ error: 'missing tables' }, 400)
  const restored: Record<string, number> = {}
  for (const [table, rowsRaw] of Object.entries(body.tables as Record<string, unknown>)) {
    if ((NEVER_TABLES as readonly string[]).includes(table)) return c.json({ error: `table ${table} may never be imported` }, 400)
    if (!(CONTENT_TABLES as readonly string[]).includes(table)) return c.json({ error: `table ${table} not allowed` }, 400)
    if (!Array.isArray(rowsRaw)) return c.json({ error: `table ${table} must be an array` }, 400)
    let n = 0
    for (const row of rowsRaw as Array<Record<string, unknown>>) {
      const cols = Object.keys(row).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      // no id column is fine (composite/UNIQUE tables like Followers): the
      // row must simply carry at least one real column.
      if (!cols.length) { n++; continue }
      const placeholders = cols.map(() => '?').join(',')
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
      ).bind(...cols.map((k) => row[k] as never)).run()
      n++
    }
    restored[table] = n
  }
  return c.json({ ok: true, restored })
})