import type { D1Turso } from '../db'

/**
 * Lootbox domain helpers: canonical DTO serialization, tag/draw-config
 * normalization, and explicit state transitions. Kept in one place so the admin
 * routes, the public store, and the pack opener all agree on the shape.
 */

export type LootboxState = 'draft' | 'released' | 'archived'

export interface LootboxRow {
  id: string
  name: string
  desc: string | null
  cost: number
  card_count: number
  rarity_theme: string
  icon: string
  badge: string | null
  released: number
  state?: LootboxState | null
  tags?: string | null
  draw_config?: string | null
  version?: number | null
  released_at?: string | null
  archived_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface LootboxDto {
  id: string
  name: string
  desc: string | null
  cost: number
  card_count: number
  rarity_theme: string
  icon: string
  badge: string | null
  released: number
  state: LootboxState
  tags: string[]
  draw_config: Record<string, unknown>
  version: number
  released_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return Array.from(new Set(
      tags
        .map((t) => String(t).trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean)
    ))
  }
  if (typeof tags === 'string') {
    return Array.from(new Set(
      tags
        .split(/[\n,]+/)
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean)
    ))
  }
  return []
}

export function normalizeDrawConfig(draw: unknown): Record<string, unknown> {
  if (draw && typeof draw === 'object' && !Array.isArray(draw)) {
    return draw as Record<string, unknown>
  }
  if (typeof draw === 'string' && draw.trim()) {
    try {
      const parsed = JSON.parse(draw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch { }
  }
  return {}
}

export function parseLootboxTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return normalizeTags(parsed)
  } catch { }
  return normalizeTags(raw)
}

export function serializeLootbox(row: LootboxRow): LootboxDto {
  const state = (row.state === 'released' || row.state === 'archived' || row.state === 'draft')
    ? row.state
    : (row.released === 1 ? 'released' : 'draft')
  return {
    id: row.id,
    name: row.name,
    desc: row.desc ?? null,
    cost: Number(row.cost ?? 0),
    card_count: Number(row.card_count ?? 3),
    rarity_theme: row.rarity_theme ?? 'rare',
    icon: row.icon ?? 'Sparkles',
    badge: row.badge ?? null,
    released: state === 'released' ? 1 : 0,
    state,
    tags: parseLootboxTags(row.tags),
    draw_config: normalizeDrawConfig(row.draw_config),
    version: Number(row.version ?? 1),
    released_at: row.released_at ?? null,
    archived_at: row.archived_at ?? null,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  }
}

export function isValidState(state: unknown): state is LootboxState {
  return state === 'draft' || state === 'released' || state === 'archived'
}

/**
 * Compute the column values implied by a requested state transition, keeping
 * the legacy `released` flag in sync.
 */
export function stateTransition(
  from: LootboxState,
  to: LootboxState
): { released: number; released_at: string | null; archived_at: string | null } | null {
  if (from === to) return null
  if (from === 'archived') return null // archived boxes are immutable

  const nowIso = new Date().toISOString()
  if (to === 'released') {
    return { released: 1, released_at: nowIso, archived_at: null }
  }
  if (to === 'archived') {
    return { released: 0, released_at: null, archived_at: nowIso }
  }
  // to === 'draft' (un-release)
  return { released: 0, released_at: null, archived_at: null }
}

const LOOTBOX_SELECT = `
  SELECT id, name, desc, cost, card_count, rarity_theme, icon, badge, released,
         state, tags, draw_config, version, released_at, archived_at, created_at, updated_at
  FROM Lootboxes
`

export async function listLootboxes(db: D1Turso): Promise<LootboxDto[]> {
  const rows = await db.prepare(`${LOOTBOX_SELECT} ORDER BY created_at ASC`).all<LootboxRow>()
  return (rows.results || []).map(serializeLootbox)
}

export async function getLootbox(db: D1Turso, id: string): Promise<LootboxDto | null> {
  const row = await db.prepare(`${LOOTBOX_SELECT} WHERE id = ?`).bind(id).first<LootboxRow>()
  return row ? serializeLootbox(row) : null
}
