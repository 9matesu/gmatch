import type { D1Turso } from './db'
import { detectProviderType } from '@orbit/shared'
import type { ProviderType, BotApiProvider, BotConfig, ApiTestResult, BotProfileRecord } from '@orbit/shared'
import { orderByWeightDesc } from './bots/provider-pool'
import crypto from 'node:crypto'

// Re-export the shared types so existing importers of this module keep working.
export type { ProviderType, BotApiProvider, BotConfig, ApiTestResult } from '@orbit/shared'

export interface BotProfile {
  id: string
  name: string
  tags: string[]
  col: string
}

export interface BotImageItem {
  id: string
  url: string
  caption?: string
  tags?: string[]
  mimeType?: string
}

// In-memory intermediary image cache (transient, never stored on disk)
interface CachedImage {
  url: string
  caption: string
  tags: string[]
  providerId?: string
  cachedAt: number
}

const memoryImageCache: CachedImage[] = []
const MAX_CACHE_SIZE = 150
const CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

const SLIDESHOW_FALLBACK_TAGS = ['futa', 'bbc', 'cum', 'veiny_cock', 'explicit']

const PALETTE = ['#ec4899', '#38bdf8', '#fbbf24', '#a855f7', '#10b981', '#f43f5e', '#6366f1', '#06b6d4']

/**
 * SystemMeta keys used by the bot configuration.
 *
 * Keep these keys centralized so GET/PUT cannot silently drift apart.
 */
const BOT_CONFIG_KEYS = {
  names: 'bot_names',
  enabled: 'bot_enabled',
  providers: 'bot_providers',
  apiUrl: 'bot_api_url',
  apiKey: 'bot_api_key',
  userId: 'bot_user_id',
  tags: 'bot_tags',
  models: 'bot_models',
  activationRule: 'bot_activation_rule',
  fallbackSeconds: 'bot_fallback_seconds',
  starterTags: 'bot_starter_tags',
} as const

type BotConfigMeta = {
  key: string
  value: string
}

function parseStringList(value: string | undefined): string[] {
  if (value === undefined) return []

  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag).trim().replace(/^#/, ''))
      .filter(Boolean)
  }

  if (typeof tags === 'string') {
    return parseStringList(tags).map((tag) => tag.replace(/^#/, ''))
  }

  return []
}

function normalizeProvider(provider: any, idx: number): BotApiProvider {
  return {
    id: typeof provider?.id === 'string' && provider.id.trim()
      ? provider.id.trim()
      : `prov_${idx + 1}`,
    name: typeof provider?.name === 'string' && provider.name.trim()
      ? provider.name.trim()
      : `API Provider ${idx + 1}`,
    providerType: provider?.providerType || detectProviderType(provider?.url || ''),
    url: typeof provider?.url === 'string' ? provider.url.trim() : '',
    apiKey: typeof provider?.apiKey === 'string' ? provider.apiKey : '',
    userId: typeof provider?.userId === 'string' ? provider.userId : '',
    customHeaders:
      provider?.customHeaders && typeof provider.customHeaders === 'object'
        ? provider.customHeaders
        : {},
    tags: normalizeTags(provider?.tags),
    enabled: provider?.enabled !== false,
    weight: typeof provider?.weight === 'number' && Number.isFinite(provider.weight)
      ? provider.weight
      : 10,
  }
}

/**
 * Retrieve Bot configuration and multi-API provider pool from SystemMeta.
 *
 * Important persistence semantics:
 * - Missing key => return empty/off defaults (no hardcoded fallbacks).
 * - Existing key containing [] => preserve the intentionally empty value.
 * - Existing key containing "" => preserve the intentionally empty value.
 *
 * This distinction prevents a successfully saved admin configuration from
 * being replaced by defaults on the next GET.
 */
export async function getBotConfig(db: D1Turso): Promise<BotConfig> {
  const rows = await db
    .prepare("SELECT key, value FROM SystemMeta WHERE key LIKE 'bot_%'")
    .bind()
    .all<BotConfigMeta>()

  const map = new Map<string, string>()

  for (const row of rows.results || []) {
    map.set(row.key, row.value)
  }

  const namesKeyExists = map.has(BOT_CONFIG_KEYS.names)
  const enabledKeyExists = map.has(BOT_CONFIG_KEYS.enabled)
  const providersKeyExists = map.has(BOT_CONFIG_KEYS.providers)
  const tagsKeyExists = map.has(BOT_CONFIG_KEYS.tags)
  const modelsKeyExists = map.has(BOT_CONFIG_KEYS.models)
  const activationRuleKeyExists = map.has(BOT_CONFIG_KEYS.activationRule)
  const fallbackSecondsKeyExists = map.has(BOT_CONFIG_KEYS.fallbackSeconds)

  const namesRaw = namesKeyExists
    ? map.get(BOT_CONFIG_KEYS.names) || ''
    : ''

  const names = parseStringList(namesRaw)

  let providers: BotApiProvider[] = []

  if (providersKeyExists) {
    const providersRaw = map.get(BOT_CONFIG_KEYS.providers) || ''

    try {
      const parsed = JSON.parse(providersRaw)

      if (Array.isArray(parsed)) {
        // Preserve [] exactly as persisted. Do not replace it with defaults.
        providers = parsed.map((provider, idx) => normalizeProvider(provider, idx))
      }
    } catch {
      // A malformed persisted provider value is treated as unavailable.
      providers = []
    }
  }

  /*
   * Global search tags are distinct from provider-local tags.
   * The admin panel's global value wins whenever bot_tags exists.
   */
  const globalTags = tagsKeyExists
    ? normalizeTags(map.get(BOT_CONFIG_KEYS.tags) || '')
    : []

  const models = modelsKeyExists
    ? parseStringList(map.get(BOT_CONFIG_KEYS.models) || '')
    : []

  const activationRule = activationRuleKeyExists
    ? (map.get(BOT_CONFIG_KEYS.activationRule) || 'fallback')
    : 'fallback'

  const fallbackSecondsRaw = fallbackSecondsKeyExists
    ? map.get(BOT_CONFIG_KEYS.fallbackSeconds)
    : undefined

  const parsedFallbackSeconds =
    fallbackSecondsRaw !== undefined
      ? Number(fallbackSecondsRaw)
      : 120

  return {
    providers,
    names: namesKeyExists
      ? names
      : [],
    enabled: enabledKeyExists
      ? map.get(BOT_CONFIG_KEYS.enabled) === '1' || map.get(BOT_CONFIG_KEYS.enabled) === 'true'
      : false,

    // Backwards compatibility: only reflect keys the admin actually saved.
    // Never synthesize values from hardcoded defaults.
    apiUrl: map.get(BOT_CONFIG_KEYS.apiUrl) || '',
    apiKey: map.get(BOT_CONFIG_KEYS.apiKey) || '',
    userId: map.get(BOT_CONFIG_KEYS.userId) || '',

    tags: globalTags,

    models,

    // Starter card tags filter for newcomer deck generation
    starterTags: map.has(BOT_CONFIG_KEYS.starterTags)
      ? parseStringList(map.get(BOT_CONFIG_KEYS.starterTags) || '')
      : ['highres', '1girl', 'solo', 'aesthetic'],

    // These properties may not exist in older @orbit/shared BotConfig versions.
    // Keep the values available at runtime without forcing an incompatible
    // type change in this module.
    activationRule,
    fallbackSeconds: Number.isFinite(parsedFallbackSeconds)
      ? Math.max(0, Math.floor(parsedFallbackSeconds))
      : 120,
  } as BotConfig
}

/**
 * Save Bot configuration and multi-API provider pool into SystemMeta.
 *
 * Every field used by the admin panel is persisted independently.
 * Existing values are updated atomically per SystemMeta key using SQLite's
 * ON CONFLICT clause.
 */
export async function saveBotConfig(
  db: D1Turso,
  config: Partial<BotConfig>
): Promise<void> {
  const statements: Array<{ key: string; val: string }> = []

  if (config.providers !== undefined) {
    const normalizedProviders = Array.isArray(config.providers)
      ? config.providers.map((provider, idx) => normalizeProvider(provider, idx))
      : []

    // Persist [] as [] instead of interpreting it as "use defaults".
    statements.push({
      key: BOT_CONFIG_KEYS.providers,
      val: JSON.stringify(normalizedProviders),
    })

    /*
     * Keep legacy fields synchronized with the primary provider when one
     * exists. If the provider pool is intentionally empty, clear the legacy
     * values so an old reader cannot resurrect stale credentials.
     */
    const primary = normalizedProviders[0]

    if (primary) {
      statements.push({ key: BOT_CONFIG_KEYS.apiUrl, val: primary.url })
      statements.push({ key: BOT_CONFIG_KEYS.apiKey, val: primary.apiKey || '' })
      statements.push({ key: BOT_CONFIG_KEYS.userId, val: primary.userId || '' })

      // Global tags explicitly supplied by the caller must remain authoritative.
      if (config.tags === undefined) {
        statements.push({
          key: BOT_CONFIG_KEYS.tags,
          val: normalizeTags(primary.tags).join(', '),
        })
      }
    } else {
      statements.push({ key: BOT_CONFIG_KEYS.apiUrl, val: '' })
      statements.push({ key: BOT_CONFIG_KEYS.apiKey, val: '' })
      statements.push({ key: BOT_CONFIG_KEYS.userId, val: '' })

      if (config.tags === undefined) {
        statements.push({ key: BOT_CONFIG_KEYS.tags, val: '' })
      }
    }
  }

  if (config.names !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.names,
      val: Array.isArray(config.names)
        ? config.names.map((name) => String(name).trim()).filter(Boolean).join(', ')
        : '',
    })
  }

  if (config.enabled !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.enabled,
      val: config.enabled ? '1' : '0',
    })
  }

  if (config.apiUrl !== undefined && config.providers === undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.apiUrl,
      val: config.apiUrl.trim(),
    })
  }

  if (config.apiKey !== undefined && config.providers === undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.apiKey,
      val: config.apiKey.trim(),
    })
  }

  if (config.userId !== undefined && config.providers === undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.userId,
      val: config.userId.trim(),
    })
  }

  if (config.tags !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.tags,
      val: normalizeTags(config.tags).join(', '),
    })
  }

  /*
   * These fields were previously accepted by the admin UI but discarded by
   * saveBotConfig(). Persist them explicitly.
   */
  const runtimeConfig = config as BotConfig & {
    models?: string[]
    activationRule?: string
    fallbackSeconds?: number
  }

  if (runtimeConfig.models !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.models,
      val: Array.isArray(runtimeConfig.models)
        ? runtimeConfig.models.map((model) => String(model).trim()).filter(Boolean).join(', ')
        : '',
    })
  }

  if (runtimeConfig.activationRule !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.activationRule,
      val: String(runtimeConfig.activationRule),
    })
  }

  if (runtimeConfig.fallbackSeconds !== undefined) {
    const fallbackSeconds = Number(runtimeConfig.fallbackSeconds)

    statements.push({
      key: BOT_CONFIG_KEYS.fallbackSeconds,
      val: String(
        Number.isFinite(fallbackSeconds)
          ? Math.max(0, Math.floor(fallbackSeconds))
          : 120
      ),
    })
  }

  if (runtimeConfig.starterTags !== undefined) {
    statements.push({
      key: BOT_CONFIG_KEYS.starterTags,
      val: Array.isArray(runtimeConfig.starterTags)
        ? runtimeConfig.starterTags.map((tag) => String(tag).trim()).filter(Boolean).join(', ')
        : String(runtimeConfig.starterTags).split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean).join(', '),
    })
  }

  // Persist every key atomically so a partial failure cannot leave the bot
  // configuration (providers, credentials, tags, names, activation) inconsistent.
  if (statements.length > 0) {
    await db.atomicBatch(
      statements.map(({ key, val }) => ({
        sql: 'INSERT INTO SystemMeta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        args: [key, val],
      }))
    )
  }
}

interface BotProfileRow {
  id: string
  name: string
  tags: string
  pfp_url: string | null
  color: string | null
  enabled: number
  sort_order: number
}

function parseBotProfileRow(row: BotProfileRow): BotProfileRecord {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags || '[]')
    if (Array.isArray(parsed)) tags = parsed.map((t: any) => String(t)).filter(Boolean)
  } catch {
    tags = parseStringList(row.tags)
  }
  return {
    id: row.id,
    name: (row.name || '').trim() || row.id,
    tags,
    pfp_url: row.pfp_url || null,
    color: row.color || null,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order ?? 0),
  }
}

/**
 * Persistent bot duelist roster, sourced from the Bots table.
 *
 * The Bots table is the single source of truth. Bots are only ever created by
 * an admin via the admin panel; there is no hardcoded/dynamic fallback roster.
 */
export async function getBotProfiles(db: D1Turso): Promise<BotProfileRecord[]> {
  const rows = await db.prepare('SELECT * FROM Bots ORDER BY sort_order ASC, name ASC').all<BotProfileRow>()
  return (rows.results || []).map(parseBotProfileRow)
}

/** Upsert a single bot profile into the Bots table. */
export async function saveBotProfile(
  db: D1Turso,
  profile: {
    id: string
    name?: string
    tags?: string[]
    pfp_url?: string | null
    color?: string | null
    enabled?: boolean
    sort_order?: number
  }
): Promise<BotProfileRecord> {
  const id = (profile.id || '').trim() || `bot_${crypto.randomUUID()}`
  const existing = await db.prepare('SELECT * FROM Bots WHERE id = ?').bind(id).first<BotProfileRow>()

  const base = parseBotProfileRow(existing || {
    id,
    name: id,
    tags: '[]',
    pfp_url: null,
    color: null,
    enabled: 1,
    sort_order: 0,
  })

  const name = profile.name !== undefined && profile.name.trim() ? profile.name.trim().slice(0, 32) : base.name
  const tags = profile.tags !== undefined ? profile.tags.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean) : base.tags
  const pfpUrl = profile.pfp_url !== undefined ? (profile.pfp_url ? String(profile.pfp_url).trim() : null) : base.pfp_url
  const color = profile.color !== undefined ? (profile.color ? String(profile.color).trim() : null) : base.color
  const enabled = profile.enabled !== undefined ? Boolean(profile.enabled) : base.enabled
  const sortOrder = profile.sort_order !== undefined ? Number(profile.sort_order) : base.sort_order

  await db.prepare(`
    INSERT INTO Bots (id, name, tags, pfp_url, color, enabled, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tags = excluded.tags,
      pfp_url = excluded.pfp_url,
      color = excluded.color,
      enabled = excluded.enabled,
      sort_order = excluded.sort_order,
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, name, JSON.stringify(tags), pfpUrl, color, enabled ? 1 : 0, sortOrder).run()

  return { id, name, tags, pfp_url: pfpUrl, color, enabled, sort_order: sortOrder }
}

/** Delete a bot profile from the Bots table. Returns false when nothing was removed. */
export async function deleteBotProfile(db: D1Turso, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM Bots WHERE id = ?').bind(id).run()
  return Number(res.meta?.changes ?? 0) > 0
}

/**
 * Resolve a picture for a bot: prefer an admin-supplied URL, otherwise fetch a
 * fresh image from the weighted active booru providers using the bot's own
 * tags. Persists the chosen URL onto the Bots row. Never throws.
 */
export async function generateBotPicture(
  db: D1Turso,
  botId: string,
  customUrl?: string
): Promise<{ ok: true; bot: BotProfileRecord } | { ok: false; error: string }> {
  const row = await db.prepare('SELECT * FROM Bots WHERE id = ?').bind(botId).first<BotProfileRow>()
  if (!row) return { ok: false, error: 'Bot not found' }
  const profile = parseBotProfileRow(row)

  let url = customUrl ? String(customUrl).trim() : ''
  if (!url) {
    const config = await getBotConfig(db).catch(() => null)
    const activeProviders = config?.enabled ? (config.providers || []).filter((p) => p.enabled && p.url) : []
    const ordered = orderByWeightDesc(activeProviders)
    if (ordered.length === 0) {
      return { ok: false, error: 'No active API providers are configured' }
    }

    const searchTags = profile.tags.length > 0 ? profile.tags : (config?.tags || [])
    for (const provider of ordered) {
      try {
        const { url: reqUrl, headers } = buildApiRequestUrl(provider, searchTags, provider.apiKey, 10, provider.userId)
        const res = await fetch(reqUrl, { method: 'GET', headers })
        if (!res.ok) continue
        const data = await res.json()
        const extracted = extractImageUrlsFromJson(data)
        if (extracted.length > 0) {
          url = extracted[Math.floor(Math.random() * extracted.length)].url
          break
        }
      } catch { /* try the next provider */ }
    }

    if (!url) {
      return { ok: false, error: 'No provider returned an image for these tags' }
    }
  }

  const bot = await saveBotProfile(db, { id: profile.id, pfp_url: url })
  return { ok: true, bot }
}

/** Build request URL for different image API providers with smart auth & parameter concatenation */
export function buildApiRequestUrl(
  input: string | Partial<BotApiProvider>,
  tags: string[] = [],
  apiKey?: string,
  limit = 10,
  userId?: string
): { url: string; headers: Record<string, string> } {
  let targetUrl = typeof input === 'string' ? input.trim() : (input.url || '').trim()
  const providerType: ProviderType = typeof input === 'object' && input.providerType
    ? input.providerType
    : detectProviderType(targetUrl)

  const resolvedApiKey = (typeof input === 'object' && input.apiKey !== undefined ? input.apiKey : apiKey)?.trim() || ''
  const resolvedUserId = (typeof input === 'object' && input.userId !== undefined ? input.userId : userId)?.trim() || ''
  const customHeaders = typeof input === 'object' && input.customHeaders ? input.customHeaders : {}

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'OrbitBotImageFetcher/1.0 (https://gmatch.pages.dev; contact@gmatch.pages.dev)',
    ...customHeaders,
  }

  // Template string interpolation if user configured {tags}, {limit}, {apiKey}, {userId} in URL
  if (targetUrl.includes('{tags}') || targetUrl.includes('{limit}') || targetUrl.includes('{apiKey}') || targetUrl.includes('{userId}')) {
    targetUrl = targetUrl
      .replace('{tags}', encodeURIComponent(tags.join(providerType === 'gelbooru' || providerType === 'danbooru' ? ' ' : ',')))
      .replace('{limit}', String(limit))
      .replace('{apiKey}', encodeURIComponent(resolvedApiKey))
      .replace('{userId}', encodeURIComponent(resolvedUserId))
    return { url: targetUrl, headers }
  }

  try {
    const parsed = new URL(targetUrl)

    // Normalize and clean tags for Booru syntax (underscores, lowercased, strip hash)
    const cleanBooruTags = tags
      .map((t) => t.trim().toLowerCase().replace(/^#/, '').replace(/[\s,]+/g, '_'))
      .filter((t) => t.length > 0 && t !== 'anime' && t !== 'aesthetic' && t !== 'waifu')

    if (providerType === 'rule34' || parsed.hostname.includes('rule34.xxx')) {
      if (!parsed.searchParams.has('page')) parsed.searchParams.set('page', 'dapi')
      if (!parsed.searchParams.has('s')) parsed.searchParams.set('s', 'post')
      if (!parsed.searchParams.has('q')) parsed.searchParams.set('q', 'index')
      if (!parsed.searchParams.has('json')) parsed.searchParams.set('json', '1')
      parsed.searchParams.set('limit', String(Math.min(limit, 50)))

      if (cleanBooruTags.length > 0) {
        parsed.searchParams.set('tags', cleanBooruTags.join(' '))
      }

      // Rule34 Auth: api_key + user_id query parameters
      if (resolvedApiKey) parsed.searchParams.set('api_key', resolvedApiKey)
      if (resolvedUserId) parsed.searchParams.set('user_id', resolvedUserId)
    } else if (providerType === 'gelbooru' || parsed.hostname.includes('gelbooru.com')) {
      // Clean query parameters without duplication
      if (!parsed.searchParams.has('page')) parsed.searchParams.set('page', 'dapi')
      if (!parsed.searchParams.has('s')) parsed.searchParams.set('s', 'post')
      if (!parsed.searchParams.has('q')) parsed.searchParams.set('q', 'index')
      if (!parsed.searchParams.has('json')) parsed.searchParams.set('json', '1')
      parsed.searchParams.set('limit', String(Math.min(limit, 50)))

      if (cleanBooruTags.length > 0) {
        parsed.searchParams.set('tags', cleanBooruTags.join(' '))
      }

      // Gelbooru Auth: api_key + user_id query parameters. DO NOT add Bearer header (causes 401)!
      if (resolvedApiKey) parsed.searchParams.set('api_key', resolvedApiKey)
      if (resolvedUserId) parsed.searchParams.set('user_id', resolvedUserId)
    } else if (providerType === 'danbooru' || parsed.hostname.includes('danbooru.donmai.us')) {
      parsed.searchParams.set('limit', String(Math.min(limit, 50)))
      if (cleanBooruTags.length > 0) {
        parsed.searchParams.set('tags', cleanBooruTags.join(' '))
      }
      if (resolvedApiKey && resolvedUserId) {
        // Danbooru supports Basic auth with login:api_key
        headers['Authorization'] = 'Basic ' + Buffer.from(`${resolvedUserId}:${resolvedApiKey}`).toString('base64')
      } else if (resolvedApiKey) {
        parsed.searchParams.set('api_key', resolvedApiKey)
        if (resolvedUserId) parsed.searchParams.set('login', resolvedUserId)
      }
    } else if (providerType === 'safebooru' || parsed.hostname.includes('safebooru.org')) {
      if (!parsed.searchParams.has('page')) parsed.searchParams.set('page', 'dapi')
      if (!parsed.searchParams.has('s')) parsed.searchParams.set('s', 'post')
      if (!parsed.searchParams.has('q')) parsed.searchParams.set('q', 'index')
      if (!parsed.searchParams.has('json')) parsed.searchParams.set('json', '1')
      parsed.searchParams.set('limit', String(Math.min(limit, 50)))
      if (cleanBooruTags.length > 0) {
        parsed.searchParams.set('tags', cleanBooruTags.join(' '))
      }
    } else if (providerType === 'e621' || parsed.hostname.includes('e621.net')) {
      headers['User-Agent'] = `OrbitBot/1.0 (by ${resolvedUserId || 'goonmatch'})`
      parsed.searchParams.set('limit', String(Math.min(limit, 50)))
      if (cleanBooruTags.length > 0) {
        parsed.searchParams.set('tags', cleanBooruTags.join(' '))
      }
      if (resolvedApiKey && resolvedUserId) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${resolvedUserId}:${resolvedApiKey}`).toString('base64')
      }
    } else if (providerType === 'waifu_im' || parsed.hostname.includes('waifu.im')) {
      if (tags.length > 0) {
        parsed.searchParams.set('included_tags', tags[0].toLowerCase().replace(/\s+/g, '-'))
      }
      parsed.searchParams.set('limit', String(Math.min(limit, 30)))
      if (resolvedApiKey) parsed.searchParams.set('token', resolvedApiKey)
    } else if (providerType === 'nekos_best' || parsed.hostname.includes('nekos.best')) {
      parsed.searchParams.set('amount', String(Math.min(limit, 20)))
    } else {
      // Generic JSON endpoint
      if (tags.length > 0 && !parsed.searchParams.has('tags') && !parsed.searchParams.has('q')) {
        parsed.searchParams.set('tags', tags.join(','))
      }
      if (!parsed.searchParams.has('limit') && !parsed.searchParams.has('count')) {
        parsed.searchParams.set('limit', String(limit))
      }
      if (resolvedApiKey && !parsed.searchParams.has('key') && !parsed.searchParams.has('api_key')) {
        parsed.searchParams.set('api_key', resolvedApiKey)
      }
      if (resolvedApiKey && !headers['Authorization'] && !headers['X-API-Key']) {
        headers['X-API-Key'] = resolvedApiKey
      }
    }

    return { url: parsed.toString(), headers }
  } catch {
    return { url: targetUrl, headers }
  }
}

/** Recursively extracts image URLs from diverse JSON schemas.
 * Per-provider rules: full-res fields win over preview/thumbnail fields
 * (never serve a thumb when a full exists); short mp4/webm loops stay,
 * only long-form videos (duration metadata > LONG_VIDEO_SEC) are dropped. */
export const LONG_VIDEO_SEC = 90

function nodeDurationSec(node: any): number | null {
  try {
    for (const c of [node?.length_sec, node?.duration, node?.lengthSec, node?.durationSec]) {
      const n = typeof c === 'string' ? Number(c) : typeof c === 'number' ? c : NaN
      if (Number.isFinite(n) && n > 0) return n
    }
    if (typeof node?.length_min === 'string') {
      const m = /^(\d+):(\d{1,2})$/.exec(node.length_min.trim())
      if (m) return Number(m[1]) * 60 + Number(m[2])
    }
  } catch { /* ignore */ }
  return null
}

export function extractImageUrlsFromJson(data: unknown): Array<{ url: string; caption?: string; tags?: string[] }> {
  const results: Array<{ url: string; caption?: string; tags?: string[] }> = []

  const isImgUrl = (val: unknown): val is string => {
    if (typeof val !== 'string') return false
    if (val.startsWith('data:image/')) return true
    let clean = val.trim()
    if (clean.startsWith('//')) clean = 'https:' + clean
    if (!/^https?:\/\//i.test(clean)) return false
    const path = clean.split('?')[0].split('#')[0].toLowerCase()
    // Stills + gif loops + short mp4/webm loops (redgifs gifs are mp4).
    if (/\.(jpg|jpeg|png|webp|gif|mp4|webm|svg|avif|jfif|bmp|tiff?|heic|heif)$/i.test(path)) return true
    return !path.includes('.') && !path.endsWith('/')
  }

  const FULL_KEYS = [
    'file_url', 'large_file_url', 'sample_url', 'image_url', 'url', 'link',
    'media_url', 'source', 'download_url', 'cdn_url', 'original', 'full',
    'raw', 'display_url', 'view_url',
  ] as const
  const THUMB_KEYS = ['preview', 'preview_url', 'thumbnail'] as const

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

  const visit = (node: any) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node === 'object') {
      // Long-form video gate: duration metadata proves it (eporner
      // length_sec, generic duration). Duration-less mp4 loops stay.
      const secs = nodeDurationSec(node)
      if (secs !== null && secs > LONG_VIDEO_SEC) return

      let candidate: string | null = null
      for (const k of FULL_KEYS) {
        const v = str((node as Record<string, unknown>)[k])
        if (v) { candidate = v; break }
      }
      if (!candidate && node.file && typeof node.file === 'object') {
        candidate = str((node.file as Record<string, unknown>).url)
      }
      // Thumb tier: only when no full-res field exists on this node.
      if (!candidate) {
        for (const k of THUMB_KEYS) {
          const v = str((node as Record<string, unknown>)[k])
          if (v) { candidate = v; break }
        }
      }
      // Eporner-style shape (default_thumb / thumbs[]) is thumb-tier too.
      if (!candidate && node.default_thumb && typeof node.default_thumb === 'object') {
        candidate = str((node.default_thumb as Record<string, unknown>).src)
      }
      if (!candidate && Array.isArray(node.thumbs) && node.thumbs.length > 0) {
        candidate = str(node.thumbs[0]?.src)
      }
      if (!candidate && typeof node.image === 'string' && /^https?:\/\//i.test(node.image)) {
        candidate = node.image
      }

      if (!candidate && node.directory && node.image) {
        candidate = `https://safebooru.org/images/${node.directory}/${node.image}`
      }

      if (typeof candidate === 'string') {
        if (candidate.startsWith('//')) candidate = 'https:' + candidate
        if (isImgUrl(candidate)) {
          let tagList: string[] = []
          if (typeof node.tag_string === 'string') tagList = node.tag_string.split(/\s+/)
          else if (typeof node.tags === 'string') tagList = node.tags.split(/\s+/)
          else if (Array.isArray(node.tags)) {
            tagList = node.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || '')).filter(Boolean)
          }

          const caption =
            node.caption ||
            node.title ||
            node.artist_name ||
            (tagList.length > 0 ? tagList.slice(0, 4).join(', ') : undefined)

          results.push({ url: candidate, caption, tags: tagList })
        }
      }

      // Check all object keys (including singular 'post', 'posts', 'images', 'data', etc.)
      for (const key of Object.keys(node)) {
        if (key === '@attributes') continue
        const val = node[key]
        if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
          visit(val)
        }
      }
    }
  }

  visit(data)
  // Stills + gif loops first, short mp4/webm loops as fallback (stable order otherwise).
  const stillFirst = (u: string): number => (/\.(mp4|webm)(?:[?#]|$)/i.test(u) ? 1 : 0)
  results.sort((a, b) => stillFirst(a.url) - stillFirst(b.url))
  return results
}

/** Test an external image API endpoint and collect detailed diagnostics */
export async function testBotApi(
  input: string | Partial<BotApiProvider>,
  apiKey?: string,
  tags: string[] = [],
  userId?: string,
  providerType?: ProviderType
): Promise<ApiTestResult> {
  const logs: string[] = []
  const start = Date.now()

  const providerObj: Partial<BotApiProvider> = typeof input === 'object'
    ? input
    : {
      url: input,
      apiKey,
      userId,
      tags,
      providerType: providerType || detectProviderType(input),
    }

  const targetUrl = providerObj.url || ''
  const resolvedKey = providerObj.apiKey || apiKey || ''
  const resolvedUid = providerObj.userId || userId || ''
  const searchTags = providerObj.tags && providerObj.tags.length > 0 ? providerObj.tags : tags

  logs.push(`[INIT] Target API URL: ${targetUrl}`)
  logs.push(`[PROVIDER] Type: ${providerObj.providerType || 'generic'}`)
  if (resolvedKey) logs.push(`[AUTH] API Key provided (${resolvedKey.substring(0, 4)}***${resolvedKey.substring(Math.max(0, resolvedKey.length - 2))})`)
  if (resolvedUid) logs.push(`[AUTH] User ID / Login: ${resolvedUid}`)
  if (searchTags.length > 0) logs.push(`[TAGS] Search tags: ${searchTags.join(', ')}`)

  const { url: requestUrl, headers } = buildApiRequestUrl(providerObj, searchTags, resolvedKey, 5, resolvedUid)
  logs.push(`[REQ] Executing GET ${requestUrl}`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(requestUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const latencyMs = Date.now() - start
    logs.push(`[RES] Received HTTP ${res.status} ${res.statusText} in ${latencyMs}ms`)

    const contentType = res.headers.get('content-type') || ''
    logs.push(`[HEADER] Content-Type: ${contentType}`)

    const text = await res.text()
    const rawSnippet = text.length > 2000 ? `${text.slice(0, 2000)}\n... [truncated]` : text

    if (!res.ok) {
      let errorMsg = `API responded with error ${res.status}: ${res.statusText}`
      if (res.status === 401 || res.status === 403) {
        errorMsg = `HTTP ${res.status} Unauthorized / Forbidden: Verify API Key, User ID / Login, and ensure no illegal Bearer headers were passed.`
      } else if (res.status === 404) {
        errorMsg = `HTTP 404 Not Found: Check the endpoint URL path.`
      } else if (res.status === 429) {
        errorMsg = `HTTP 429 Rate Limit Exceeded: External provider rate limit reached.`
      }

      logs.push(`[ERROR] ${errorMsg}`)
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        latencyMs,
        foundCount: 0,
        sampleUrls: [],
        rawResponse: rawSnippet,
        logs,
        error: errorMsg,
      }
    }

    let parsedData: unknown
    try {
      parsedData = JSON.parse(text)
    } catch {
      const err = 'Response is not valid JSON. Ensure the endpoint returns application/json.'
      logs.push(`[PARSE_ERROR] ${err}`)
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        latencyMs,
        foundCount: 0,
        sampleUrls: [],
        rawResponse: rawSnippet,
        logs,
        error: err,
      }
    }

    let extracted = extractImageUrlsFromJson(parsedData)
    logs.push(`[EXTRACT] Extracted ${extracted.length} image URL(s) from response`)

    // Automatic Fallback: If HTTP 200 returned but 0 images found (e.g. strict tag combination matched 0 posts on Booru)
    if (extracted.length === 0 && searchTags.length > 0) {
      logs.push(`[FALLBACK] Strict tag combination [${searchTags.join(', ')}] returned 0 posts. Fetching fallback images without tags...`)
      try {
        const { url: fallbackUrl, headers: fallbackHeaders } = buildApiRequestUrl(providerObj, [], resolvedKey, 5, resolvedUid)
        if (fallbackUrl !== requestUrl) {
          const fallbackRes = await fetch(fallbackUrl, { method: 'GET', headers: fallbackHeaders })
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json()
            const fallbackExtracted = extractImageUrlsFromJson(fallbackData)
            if (fallbackExtracted.length > 0) {
              extracted = fallbackExtracted
              logs.push(`[FALLBACK_SUCCESS] Retrieved ${extracted.length} image(s) from fallback search.`)
            }
          }
        }
      } catch (fErr: any) {
        logs.push(`[FALLBACK_ERR] Fallback failed: ${fErr?.message || fErr}`)
      }
    }

    if (extracted.length === 0) {
      const err = `API returned HTTP 200, but no image URLs were found for tags: [${searchTags.join(', ')}]. Try broader tags or verify provider schema.`
      logs.push(`[WARN] ${err}`)
      return {
        ok: false,
        status: res.status,
        statusText: res.statusText,
        latencyMs,
        foundCount: 0,
        sampleUrls: [],
        rawResponse: rawSnippet,
        logs,
        error: err,
      }
    }

    const sampleUrls = extracted.slice(0, 6).map((e) => e.url)
    logs.push(`[SUCCESS] Connected cleanly! Extracted ${extracted.length} image(s). Sample: ${sampleUrls[0]}`)

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      latencyMs,
      foundCount: extracted.length,
      sampleUrls,
      rawResponse: rawSnippet,
      logs,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    const isAbort = err?.name === 'AbortError'
    const errorMsg = isAbort
      ? 'Request timed out after 10 seconds. Check endpoint responsiveness.'
      : `Network error: ${err?.message || err}`

    logs.push(`[EXCEPTION] ${errorMsg}`)
    return {
      ok: false,
      status: isAbort ? 504 : 500,
      statusText: isAbort ? 'Gateway Timeout' : 'Internal Error',
      latencyMs,
      foundCount: 0,
      sampleUrls: [],
      rawResponse: '',
      logs,
      error: errorMsg,
    }
  }
}

/** Fetch a batch of fresh images from active providers and cache in memory */
export async function refreshBotImageCache(
  db: D1Turso,
  count = 20,
  playerTags?: string[]
): Promise<CachedImage[]> {
  const config = await getBotConfig(db)
  if (!config.enabled) return memoryImageCache

  const activeProviders = orderByWeightDesc(config.providers.filter((p) => p.enabled && p.url))
  if (activeProviders.length === 0) return memoryImageCache

  const now = Date.now()

  // If specific player tags are requested, attempt targeted query
  if (playerTags && playerTags.length > 0) {
    for (const provider of activeProviders) {
      try {
        const { url, headers } = buildApiRequestUrl(provider, playerTags, provider.apiKey, count, provider.userId)
        const res = await fetch(url, { method: 'GET', headers })
        if (res.ok) {
          const data = await res.json()
          const extracted = extractImageUrlsFromJson(data)
          if (extracted.length > 0) {
            for (const item of extracted) {
              if (!memoryImageCache.some((c) => c.url === item.url)) {
                memoryImageCache.unshift({
                  url: item.url,
                  caption: item.caption || playerTags.slice(0, 2).join(' ') || provider.name,
                  tags: item.tags || playerTags,
                  providerId: provider.id,
                  cachedAt: now,
                })
              }
            }
            break // Found matching images from player tags
          }
        }
      } catch (e) {
        console.error(`[BotImageApi] Failed to fetch player tag images from ${provider.name}:`, e)
      }
    }
  }

  // Populate from provider tag pools
  for (const provider of activeProviders) {
    try {
      const { url, headers } = buildApiRequestUrl(provider, provider.tags, provider.apiKey, count, provider.userId)
      const res = await fetch(url, { method: 'GET', headers })
      if (!res.ok) continue

      const data = await res.json()
      let extracted = extractImageUrlsFromJson(data)

      // Fallback without tags if strict tag returned 0
      if (extracted.length === 0 && provider.tags.length > 0) {
        const { url: fallbackUrl, headers: fallbackHeaders } = buildApiRequestUrl(provider, [], provider.apiKey, count, provider.userId)
        if (fallbackUrl !== url) {
          const fallbackRes = await fetch(fallbackUrl, { method: 'GET', headers: fallbackHeaders })
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json()
            extracted = extractImageUrlsFromJson(fallbackData)
          }
        }
      }

      for (const item of extracted) {
        if (!memoryImageCache.some((c) => c.url === item.url)) {
          memoryImageCache.unshift({
            url: item.url,
            caption: item.caption || provider.tags.slice(0, 2).join(' ') || provider.name,
            tags: item.tags || provider.tags,
            providerId: provider.id,
            cachedAt: now,
          })
        }
      }
    } catch (e) {
      console.error(`[BotImageApi] Failed to fetch pool images from ${provider.name}:`, e)
    }
  }

  // Trim excess items
  while (memoryImageCache.length > MAX_CACHE_SIZE) {
    memoryImageCache.pop()
  }

  return memoryImageCache
}

/** Pick or dynamically generate a card for a bot duelist based on player tags */
export async function pickBotDuelCard(
  db: D1Turso,
  botId: string,
  botName: string,
  playerTags?: string[]
): Promise<{ url: string; caption: string }> {
  // 1. If player has tags, deploy targeted live API search
  if (playerTags && playerTags.length > 0) {
    const config = await getBotConfig(db)
    if (config.enabled) {
      const activeProviders = orderByWeightDesc(config.providers.filter((p) => p.enabled && p.url))

      for (const provider of activeProviders) {
        try {
          const { url, headers } = buildApiRequestUrl(provider, playerTags, provider.apiKey, 6, provider.userId)
          const res = await fetch(url, { method: 'GET', headers })
          if (res.ok) {
            const data = await res.json()
            const extracted = extractImageUrlsFromJson(data)
            if (extracted.length > 0) {
              const picked = extracted[Math.floor(Math.random() * extracted.length)]
              return {
                url: picked.url,
                caption: `${picked.caption || playerTags.slice(0, 2).join(' ')} (${botName})`,
              }
            }
          }
        } catch { }
      }
    }
  }

  // 2. Fallback: If memory cache has items, pick from random pool
  const freshCache = memoryImageCache.filter((c) => Date.now() - c.cachedAt < CACHE_TTL_MS)
  if (freshCache.length > 0) {
    const picked = freshCache[Math.floor(Math.random() * freshCache.length)]
    return {
      url: picked.url,
      caption: `${picked.caption} (${botName})`,
    }
  }

  // 3. Fallback: Attempt live fetch from general pool
  const fresh = await refreshBotImageCache(db, 10, playerTags)
  if (fresh.length > 0) {
    const picked = fresh[Math.floor(Math.random() * fresh.length)]
    return {
      url: picked.url,
      caption: `${picked.caption} (${botName})`,
    }
  }

  // 4. Ultimate offline fallback: Procedural SVG card
  const randomColor1 = PALETTE[Math.floor(Math.random() * PALETTE.length)]
  const randomColor2 = PALETTE[Math.floor(Math.random() * PALETTE.length)]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${randomColor1}"/><stop offset="100%" stop-color="${randomColor2}"/></linearGradient></defs><rect width="400" height="560" rx="24" fill="#09090b"/><rect x="12" y="12" width="376" height="536" rx="16" fill="url(#bg)" fill-opacity="0.2" stroke="url(#bg)" stroke-width="2"/><circle cx="200" cy="240" r="90" fill="url(#bg)" fill-opacity="0.85"/><text x="200" y="250" font-family="sans-serif" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle">⚡</text><text x="200" y="420" font-family="sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${botName}</text><text x="200" y="450" font-family="sans-serif" font-size="12" font-weight="600" fill="#a1a1aa" text-anchor="middle">ARCADE DUELIST CARD</text></svg>`
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

  return {
    url: dataUrl,
    caption: `${botName} Duel Card`,
  }
}

/** Fetch a batch of images from the configured booru providers for a specific
 * tag query. Used by user-created "api" slideshows. Never throws — returns an
 * empty list when no providers are configured or reachable. */
export async function getSlideshowImagesByTags(
  db: D1Turso,
  tags: string[],
  limit = 20
): Promise<Array<{ url: string; caption?: string }>> {
  const safeLimit = Math.max(1, Math.min(limit, 50))
  const searchTags = (Array.isArray(tags) && tags.length > 0 ? tags : SLIDESHOW_FALLBACK_TAGS)
    .map((t) => String(t).trim())
    .filter(Boolean)

  const config = await getBotConfig(db).catch(() => null)
  const activeProviders = config?.enabled ? (config.providers || []).filter((p) => p.enabled && p.url) : []
  const collected: Array<{ url: string; caption?: string }> = []

  for (const provider of activeProviders) {
    try {
      const { url, headers } = buildApiRequestUrl(provider, searchTags, provider.apiKey, safeLimit, provider.userId)
      const res = await fetch(url, { method: 'GET', headers })
      if (!res.ok) continue
      const data = await res.json()
      const extracted = extractImageUrlsFromJson(data)
      for (const item of extracted) {
        if (!collected.some((c) => c.url === item.url)) {
          collected.push({ url: item.url, caption: item.caption || searchTags.slice(0, 2).join(' ') })
        }
      }
      if (collected.length >= safeLimit) break
    } catch { }
  }

  return collected.slice(0, safeLimit)
}
