import { create } from 'zustand'
import { getSecureItem } from '../utils/secure-storage'
import { clickGain, clickPower, heatMultiplier, heatStreakAfter, isCrit, passiveGps } from './economy'
import type { EconomyInput } from './economy'
import { buyTag as buyTagLevel, deriveTagStats, discoverTags, feedQuery, mergeTags as mergeTagList, normalizeCustomTag, removeTag as removeTagList, setupTag, soloTag as soloTagList, toggleTag as toggleTagLevel, validateCustomTag } from './tags'
import { buildRoundQueries, roundQueryKey, PILLS_PER_ROUND, RECENT_QUERY_DEPTH } from './queryBuilder'
import { getUserExcludes, isNoise, isQueryBlocked, rankTags, setUserExcludes } from './tagFilter'
import { learnPurge, setCoRules, setFeedIntent } from './tagCooccur'
import { KILL_XP, foeMaxHp, killBonusPoints } from './battle'
import { CAPS, activeCaps, capAutoClicksPerSec, popCap as popCapList } from './caps'
import { imageRarity } from './rarity'
import { applyBrainmelt, canBrainmelt, tierForXp, titleForTier } from './prestige'
import { ACHIEVEMENTS, newlyEarned } from './achievements'
import type { AchievementStats } from './achievements'
import {
  SAVE_KEY,
  SAVE_VERSION,
  defaultSave,
  deserialize,
  offlineEarnings,
  serialize,
} from './save'
import type { SaveData } from './save'
import { fetchPosts, fetchPostsMulti, matchesQuery, clearMirrorCooldowns, clearSeenMemory } from '../services/booru'
import { vaultPin, vaultUnpin, vaultRemove } from '../services/vault'
import { evictImage, clearFeedCache } from '../services/imageCache'
import { isCustomMediaUrl, sampleCustomSources } from '../services/customSources'
import type { ActiveCap, BooruPost, CapId, CustomSource, GalleryImage, GridCell, KoDrop, OwnedTag, ViewMode } from './types'

export interface Toast {
  id: number
  msg: string
}

export interface ClickResult {
  gain: number
  crit: boolean
  killed: boolean
  /** Heat combo multiplier applied to this click (>=1). */
  heat: number
}

export interface GameState {
  loaded: boolean
  /** Idle-game points — purely local, never the server g$ wallet. */
  points: number
  totalEarned: number
  xp: number
  clicks: number
  crits: number
  tags: OwnedTag[]
  gallery: GalleryImage[]
  caps: ActiveCap[]
  capsUsed: CapId[]
  shards: number
  prestigeCount: number
  achievements: string[]
  collectedOfflineEarnings: boolean
  ageVerified: boolean
  lastSaved: number
  lastSeenAt: number
  current: BooruPost | null
  queue: BooruPost[]
  /** Viewed-image history for the back arrow (session-only, not saved). */
  past: BooruPost[]
  /** Skipped-grid snapshots for the grid back arrow (session-only). */
  gridPast: GridCell[][]
  /** Gallery image used as the app backdrop (persisted). Null = flat steel. */
  backgroundUrl: string | null
  /** Feed stage layout: single foe or 3x3 grid (persisted). Grid cells are session-only. */
  viewMode: ViewMode
  /** Live 3x3 grid squares (session-only, refilled from the queue). */
  grid: GridCell[]
  /** Live foe: HP left / max, clicks landed, lifetime KOs. max 0 = no battle. */
  foeHp: number
  foeMaxHp: number
  foeClicks: number
  /** Heat combo: current streak + timestamp of the last click (session-only). */
  heatStreak: number
  lastClickAt: number
  /** Best heat streak ever banked (persisted, achievement stat). */
  maxHeatStreak: number
  defeated: number
  /** Round-robin cursor over the tag pool — one tag per fetch, never stacked. */
  feedCursor: number
  priorityTag: string | null
  /** Recent round query keys (order-independent pill sets): consecutive
   * rounds never repeat the same queries (session-only, not saved). */
  recentQueryKeys: string[]
  feedOffline: boolean
  /** True when sources answer but everything was already seen (pool
   *  exhausted) — distinct from network-offline for UI copy. */
  feedEmptyFresh: boolean
  fetching: boolean
  /** True only while the CURRENT stage image is resolved + decoded. Clicks
   *  are dead until it flips — the game never runs on a missing/uncached
   *  picture (session RAM cache only, nothing hits disk). */
  imageReady: boolean
  setImageReady: (ready: boolean) => void
  toasts: Toast[]
  offlineGain: number

  clickImage: () => ClickResult
  clickCell: (index: number) => ClickResult
  dropCell: (index: number) => void
  setViewMode: (mode: ViewMode) => void
  reorderGrid: (from: number, to: number) => void
  /** KO novelty pipeline (session-only): generated per drain from foe tags. */
  pendingDrops: KoDrop[]
  claimDropTag: (id: string) => boolean
  claimDropAntiTag: (id: string) => boolean
  dismissDrop: (id: string) => void
  /** Player-picked starter tags + extra excludes (setup screen, one shot). */
  setupComplete: boolean
  userExcludes: string[]
  coRules: { a: string; b: string; count: number }[]
  /** Player-owned feed sources (custom URLs / local folders, tried first). */
  customSources: CustomSource[]
  addUrlSource: (label: string, rawUrls: string[]) => { added: boolean; message: string }
  addFolderSource: (folderId: string, folderPath: string, label?: string) => { added: boolean; message: string }
  removeCustomSource: (id: string) => void
  toggleCustomSource: (id: string) => void
  completeSetup: (tags: string[], excludes: string[]) => { ok: boolean; message: string }
  /** Re-run the setup picks after the first one (Settings → Feed / onboarding edit). */
  updateSetup: (tags: string[], excludes: string[]) => { ok: boolean; message: string }
  addUserExclude: (raw: string) => boolean
  removeUserExclude: (term: string) => boolean
  buyTag: (name: string) => boolean
  toggleTag: (name: string) => boolean
  soloTag: (name: string) => boolean
  deleteTag: (name: string) => boolean
  mergeTags: (a: string, b: string) => boolean
  refreshTagMarket: () => Promise<void>
  addCustomTag: (raw: string) => Promise<{ added: boolean; message: string }>
  allowReal: boolean
  allowHentai: boolean
  toggleFeedCategory: (cat: 'real' | 'hentai') => void
  fetchFeed: (opts?: { manual?: boolean }) => Promise<void>
  /** Manual retry: clears backoff + mirror cooldowns, then fetches. */
  retryFeedManual: () => void
  advanceFeed: () => void
  goBack: () => boolean
  /** Grid mode: swap the whole board for a fresh one (session-only history). */
  skipGrid: () => void
  /** "Never show this again": seen + bytes evicted + rarest content tags
   * learned as anti-tags (player intent beats algorithm: feed tags never
   * become excludes). */
  purgePost: (post: BooruPost) => void
  undoGrid: () => boolean
  setBackground: (url: string | null) => void
  featureImage: (id: string) => void
  /** Permanently delete a keepsake from the gallery (never blocks play). */
  removeGalleryImage: (id: string) => boolean
  popCap: (capId: CapId) => boolean
  brainmelt: () => boolean
  tick: (dtMs?: number) => void
  save: () => void
  load: () => void
  collectOffline: () => void
  verifyAge: () => void
  dismissToast: (id: number) => void
  clearToasts: () => void
  /** Push a message into the header toast log from outside the game loop (e.g. domination payout). */
  notify: (msg: string) => void
  resetGame: () => void
}

let toastSeq = 1

/**
 * Save slot keyed by the active Orbit identity (plan 4.3): switching accounts
 * on the same machine never leaks the idle run across wallets. Before an
 * identity exists the plain SAVE_KEY slot is used (pre-login play).
 */
function saveKey(): string {
  try {
    const raw = getSecureItem('orbit_identity')
    const id = raw ? (JSON.parse(raw) as { orbitId?: string }).orbitId : null
    return id ? `${SAVE_KEY}:${id}` : SAVE_KEY
  } catch {
    return SAVE_KEY
  }
}

function readStorage(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(saveKey()) : null
  } catch {
    return null
  }
}

function writeStorage(raw: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(saveKey(), raw)
  } catch {
    /* storage unavailable — game still runs in-memory */
  }
}

/** Deterministic per-post base price (SPEC §4 rarity ladder 0-5000+). */
export function rarityBaseForPost(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return 50 + (h % 4951)
}

function econ(s: GameState): EconomyInput {
  return {
    shards: s.shards,
    achievementsEarned: s.achievements.length,
    tags: s.tags,
    gallery: s.gallery,
    caps: s.caps,
  }
}

function statsOf(s: GameState): AchievementStats {
  return {
    clicks: s.clicks,
    crits: s.crits,
    tagsOwned: s.tags.reduce((n, t) => n + (t.level > 0 ? 1 : 0), 0),
    galleryOwned: s.gallery.length,
    hasDiamond: s.gallery.some((g) => g.rarity === 'Diamond'),
    capsUsed: s.capsUsed,
    prestiges: s.prestigeCount,
    shards: s.shards,
    tier: tierForXp(s.xp),
    collectedOfflineEarnings: s.collectedOfflineEarnings,
    maxHeatStreak: s.maxHeatStreak,
  }
}

function pushToast(s: GameState, msg: string): Toast[] {
  const next = [...s.toasts, { id: toastSeq++, msg }]
  // Cap the log so a long session can't bloat the save; header tab pages it.
  return next.slice(-50)
}

/** Achievement + tier-up side effects, applied after any state change. */
function progress(s: GameState, prevXp: number): Pick<GameState, 'achievements' | 'toasts'> {
  let toasts = s.toasts
  let achievements = s.achievements
  const fresh = newlyEarned(achievements, statsOf(s))
  if (fresh.length > 0) {
    achievements = [...achievements, ...fresh]
    for (const id of fresh) {
      const def = ACHIEVEMENTS.find((a) => a.id === id)
      if (def) toasts = [...toasts, { id: toastSeq++, msg: `Achievement unlocked: ${def.name}` }]
    }
  }
  const after = tierForXp(s.xp)
  if (after > tierForXp(prevXp)) {
    toasts = [...toasts, { id: toastSeq++, msg: `Pornification up — you are now a ${titleForTier(after)}` }]
  }
  return { achievements, toasts }
}

function freshData() {
  return {
    loaded: false,
    points: 0,
    totalEarned: 0,
    xp: 0,
    clicks: 0,
    crits: 0,
    tags: [] as OwnedTag[],
    setupComplete: false,
    userExcludes: [] as string[],
    coRules: [] as { a: string; b: string; count: number }[],
    customSources: [] as CustomSource[],
    gallery: [] as GalleryImage[],
    caps: [] as ActiveCap[],
    capsUsed: [] as CapId[],
    shards: 0,
    prestigeCount: 0,
    achievements: [] as string[],
    collectedOfflineEarnings: false,
    ageVerified: false,
    lastSaved: 0,
    lastSeenAt: Date.now(),
    current: null as BooruPost | null,
    queue: [] as BooruPost[],
    past: [] as BooruPost[],
    gridPast: [] as GridCell[][],
    backgroundUrl: null as string | null,
    viewMode: 'single' as ViewMode,
    grid: [] as GridCell[],
    pendingDrops: [] as KoDrop[],
    foeHp: 0,
    foeMaxHp: 0,
    foeClicks: 0,
    heatStreak: 0,
    lastClickAt: 0,
    maxHeatStreak: 0,
    defeated: 0,
    feedCursor: 0,
    priorityTag: null,
    recentQueryKeys: [] as string[],
    feedOffline: false,
    feedEmptyFresh: false,
    fetching: false,
    imageReady: false,
    allowReal: typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.feed.allowReal') !== '0' : true,
    allowHentai: typeof localStorage !== 'undefined' ? localStorage.getItem('gmatch.feed.allowHentai') !== '0' : true,
    toasts: [] as Toast[],
    offlineGain: 0,
  }
}

/**
 * Drain a foe into the gallery. Shared by manual clicks and auto-click ticks.
 * Caller supplies the state snapshot and clicks landed on this foe.
 */

/** Viewed-image history cap for the back arrow. */
export const HISTORY_CAP = 50

/** Setup screen: exactly this many starter tags, picked by the player. */
export const SETUP_TAG_COUNT = 4

/** Cap on player-excluded terms (setup screen + config tab). */
export const MAX_USER_EXCLUDES = 100

/**
 * Fisher-Yates shuffle (new array). Feed posts are randomized on receipt so
 * the game never pushes API result order sequentially (SPEC §6).
 */
export function shufflePosts<T>(posts: readonly T[]): T[] {
  const out = [...posts]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Push the leaving image onto the back-arrow history. */
function pushPast(past: BooruPost[], post: BooruPost | null): BooruPost[] {
  if (!post) return past
  return [...past, post].slice(-HISTORY_CAP)
}

/**
 * Keep rule for unseen posts after a tag-intent change (solo/remove/
 * deselect): untagged posts can't be attributed to any tag (they come from
 * tag-targeted searches), so they stay; tagged posts stay only when they
 * match the new intent. Gallery/past history is never touched.
 */
function postMatchesIntent(post: BooruPost, intent: string): boolean {
  if (post.tags.length === 0) return true
  return matchesQuery(post, intent)
}

/** Silent feed retry: sources are never allowed to kill the game.
 * Backoff 5s → 10s → 20s → 40s → 60s cap (session-only, module timer).
 * Success clears via clearFeedRetry. Test hook: lastFeedRetryMs + reset. */
let feedRetryTimer: ReturnType<typeof setTimeout> | null = null
let feedRetryStep = 0
export let lastFeedRetryMs = 0
export function __resetFeedRetryForTests() {
  if (feedRetryTimer) clearTimeout(feedRetryTimer)
  feedRetryTimer = null
  feedRetryStep = 0
  lastFeedRetryMs = 0
}
function clearFeedRetry() {
  if (feedRetryTimer) clearTimeout(feedRetryTimer)
  feedRetryTimer = null
  feedRetryStep = 0
  lastFeedRetryMs = 0
}
function scheduleFeedRetry(gentle = false) {
  if (feedRetryTimer) return
  if (gentle) feedRetryStep = 0
  const delay = Math.min(60_000, 5_000 * 2 ** feedRetryStep)
  feedRetryStep += 1
  lastFeedRetryMs = delay
  // ponytail: module timer, unref'd so tests/exit never hang; store.fetchFeed on fire
  feedRetryTimer = setTimeout(() => {
    feedRetryTimer = null
    void useGame.getState().fetchFeed()
  }, delay)
  if (typeof feedRetryTimer === 'object' && feedRetryTimer !== null && 'unref' in feedRetryTimer) {
    ; (feedRetryTimer as { unref: () => void }).unref()
  }
}
/** Session-only snapshots of skipped grids (undo stack for the grid arrows). */
export const GRID_HISTORY_CAP = 10

/** 3x3 grid size — nine live squares (ceiling; per-layout targets below). */
export const GRID_SIZE = 9

/** Live grid squares per layout: 1x1=1, 1x2=2, 2x2=4, 3x3=9. */
export function gridSizeForMode(mode: ViewMode): number {
  switch (mode) {
    case '1x1': return 1
    case '1x2': return 2
    case '2x2': return 4
    case '3x3': return 9
    case 'grid': return 9
    default: return 0
  }
}

/** Fill empty grid squares from the queue head (fresh HP per cell). Pure. */
function fillGrid(
  grid: GridCell[],
  queue: BooruPost[],
  defeated: number,
  target = GRID_SIZE,
): { grid: GridCell[]; queue: BooruPost[] } {
  const g = [...grid]
  const q = [...queue]
  while (g.length < target && q.length > 0) {
    const post = q.shift() as BooruPost
    const maxHp = foeMaxHp(defeated)
    g.push({ post, hp: maxHp, maxHp, clicks: 0 })
  }
  return { grid: g, queue: q }
}

/** True when the mode shows grid squares (3x3 layouts + legacy 'grid'). */
export function isGridMode(mode: ViewMode): boolean {
  return mode !== 'single' && mode !== '1x1'
}

/** Shared drain reward: gallery keep + market discovery + past + KO count + novelty drop. */
function gallerySpoils(s: GameState, post: BooruPost, clicksOnFoe: number, now: number) {
  const defeated = s.defeated + 1
  const rarityBase = rarityBaseForPost(post.id)
  const bonus = killBonusPoints(rarityBase)
  const img: GalleryImage = {
    id: `${post.id}:${now}`,
    url: post.url,
    tags: post.tags,
    rarityBase,
    clicks: clicksOnFoe,
    rarity: imageRarity(rarityBase, s.gallery.length, clicksOnFoe),
    boughtAt: now,
    kind: post.kind,
    preview: post.preview,
  }
  // Novelty drop (non-blocking): one suggested tag + one anti-tag from the foe.
  const ownedNames = new Set(s.tags.map((t) => t.name.toLowerCase()))
  const cleanFoeTags = post.tags
    .map((t) => normalizeCustomTag(String(t)))
    .filter((t) => t.length >= 2 && !isQueryBlocked(t) && !isNoise(t))
  const candidateTag = cleanFoeTags.find((t) => !ownedNames.has(t))
  const candidateAntiTag = cleanFoeTags.find(
    (t) => t !== candidateTag && !s.userExcludes.includes(t),
  )
  const newDrop: KoDrop | null =
    candidateTag || candidateAntiTag
      ? {
          id: `drop:${post.id}:${now}`,
          foeTitle: cleanFoeTags[0] ?? 'foe',
          suggestedTag: candidateTag,
          suggestedAntiTag: candidateAntiTag,
          timestamp: now,
        }
      : null
  const pendingDrops = newDrop
    ? [newDrop, ...s.pendingDrops.filter((d) => d.id !== newDrop.id)].slice(0, 8)
    : s.pendingDrops
  // Local vault (opt-in): pin the keep's bytes to disk in the background.
  // Lookup-only reads never write, so this is the single write trigger.
  if (img.url) void vaultPin(img.url)
  return {
    defeated,
    bonus,
    img,
    gallery: [...s.gallery, img],
    // Auto-generated market: the drained foe's tags become buyable offers.
    tags: discoverTags(s.tags, post.tags),
    // The drained foe stays reachable via the back arrow (shown beaten, no HP).
    past: pushPast(s.past, post),
    pendingDrops,
  }
}

function koFoe(s: GameState, now: number, clicksOnFoe: number) {
  const post = s.current as BooruPost
  const spoil = gallerySpoils(s, post, clicksOnFoe, now)
  const current = s.queue[0] ?? null
  const queue = s.queue.slice(1)
  // Harder with each KO: the next foe scales off the new lifetime total.
  const foe = current ? foeMaxHp(spoil.defeated) : 0
  return {
    ...spoil,
    current,
    queue,
    foeHp: foe,
    foeMaxHp: foe,
    foeClicks: 0,
  }
}

export const useGame = create<GameState>((set, get) => ({
  ...freshData(),

  setImageReady: (ready) => set({ imageReady: ready }),

  clickImage: () => {
    const s = get()
    const now = Date.now()
    // The game never runs blind: no current post or its picture is not
    // cached + decoded yet — click is dead (no pts, no counters).
    if (!s.current || !s.imageReady) return { gain: 0, crit: false, killed: false, heat: 1 }
    const clickNumber = s.clicks + 1
    const crit = isCrit(clickNumber)
    // Heat combo: rapid clicks stack up to x3; idling past the window resets.
    const streak = heatStreakAfter(s.heatStreak, s.lastClickAt, now)
    const heat = heatMultiplier(streak)
    // Damage equals the click's pts gain — store power-ups (caps, shards,
    // achievements) hit harder, crits deal x10, heat stacks on top.
    const gain = clickGain(econ(s), clickNumber, now, streak)
    const clickXp = crit ? 5 : 1
    // No live foe (re-featured gallery piece): clicks just pay pts.
    if (s.foeMaxHp <= 0) {
      const next: GameState = {
        ...s,
        points: s.points + gain,
        totalEarned: s.totalEarned + gain,
        clicks: clickNumber,
        crits: s.crits + (crit ? 1 : 0),
        xp: s.xp + clickXp,
      }
      set({
        points: next.points,
        totalEarned: next.totalEarned,
        clicks: next.clicks,
        crits: next.crits,
        xp: next.xp,
        heatStreak: streak,
        lastClickAt: now,
        maxHeatStreak: Math.max(s.maxHeatStreak, streak),
        ...progress(next, s.xp),
      })
      return { gain, crit, killed: false, heat }
    }
    const clicksOnFoe = s.foeClicks + 1
    const hpLeft = s.foeHp - gain
    if (hpLeft > 0) {
      const next: GameState = {
        ...s,
        points: s.points + gain,
        totalEarned: s.totalEarned + gain,
        clicks: clickNumber,
        crits: s.crits + (crit ? 1 : 0),
        xp: s.xp + clickXp,
        foeHp: hpLeft,
        foeClicks: clicksOnFoe,
      }
      set({
        points: next.points,
        totalEarned: next.totalEarned,
        clicks: next.clicks,
        crits: next.crits,
        xp: next.xp,
        foeHp: next.foeHp,
        foeClicks: next.foeClicks,
        heatStreak: streak,
        lastClickAt: now,
        maxHeatStreak: Math.max(s.maxHeatStreak, streak),
        ...progress(next, s.xp),
      })
      return { gain, crit, killed: false, heat }
    }
    // KO: the drained foe joins the gallery with a pts kill bonus.
    const ko = koFoe(s, now, clicksOnFoe)
    const next: GameState = {
      ...s,
      points: s.points + gain + ko.bonus,
      totalEarned: s.totalEarned + gain + ko.bonus,
      clicks: clickNumber,
      crits: s.crits + (crit ? 1 : 0),
      xp: s.xp + clickXp + KILL_XP,
      tags: ko.tags,
      past: ko.past,
      gallery: ko.gallery,
      defeated: ko.defeated,
      pendingDrops: ko.pendingDrops,
      current: ko.current,
      queue: ko.queue,
      foeHp: ko.foeHp,
      foeMaxHp: ko.foeMaxHp,
      foeClicks: ko.foeClicks,
    }
    next.toasts = pushToast(next, `Drained ${ko.img.rarity} foe (+${ko.bonus} pts) — kept in gallery`)
    set({
      points: next.points,
      totalEarned: next.totalEarned,
      clicks: next.clicks,
      crits: next.crits,
      xp: next.xp,
      tags: next.tags,
      past: next.past,
      gallery: next.gallery,
      defeated: next.defeated,
      pendingDrops: next.pendingDrops,
      current: next.current,
      queue: next.queue,
      foeHp: next.foeHp,
      foeMaxHp: next.foeMaxHp,
      foeClicks: next.foeClicks,
      heatStreak: streak,
      lastClickAt: now,
      maxHeatStreak: Math.max(s.maxHeatStreak, streak),
      ...progress(next, s.xp),
    })
    if (!ko.current) void get().fetchFeed()
    return { gain, crit, killed: true, heat }
  },

  clickCell: (index) => {
    const s = get()
    const now = Date.now()
    const clickNumber = s.clicks + 1
    const crit = isCrit(clickNumber)
    const streak = heatStreakAfter(s.heatStreak, s.lastClickAt, now)
    const heat = heatMultiplier(streak)
    const gain = clickGain(econ(s), clickNumber, now, streak)
    const clickXp = crit ? 5 : 1
    const cell = s.grid[index]
    // Empty square: dead click, no reward, no counters.
    if (!cell) return { gain: 0, crit: false, killed: false, heat: 1 }
    const clicksOnCell = cell.clicks + 1
    const hpLeft = cell.hp - gain
    if (hpLeft > 0) {
      const grid = s.grid.map((c, i) => (i === index ? { ...c, hp: hpLeft, clicks: clicksOnCell } : c))
      const next: GameState = {
        ...s,
        points: s.points + gain,
        totalEarned: s.totalEarned + gain,
        clicks: clickNumber,
        crits: s.crits + (crit ? 1 : 0),
        xp: s.xp + clickXp,
        grid,
      }
      set({
        points: next.points,
        totalEarned: next.totalEarned,
        clicks: next.clicks,
        crits: next.crits,
        xp: next.xp,
        grid: next.grid,
        heatStreak: streak,
        lastClickAt: now,
        maxHeatStreak: Math.max(s.maxHeatStreak, streak),
        ...progress(next, s.xp),
      })
      return { gain, crit, killed: false, heat }
    }
    // KO: the drained square joins the gallery; a fresh foe slides in.
    const spoil = gallerySpoils(s, cell.post, clicksOnCell, now)
    const filled = fillGrid(
      s.grid.filter((_, i) => i !== index),
      s.queue,
      spoil.defeated,
      gridSizeForMode(s.viewMode),
    )
    const next: GameState = {
      ...s,
      points: s.points + gain + spoil.bonus,
      totalEarned: s.totalEarned + gain + spoil.bonus,
      clicks: clickNumber,
      crits: s.crits + (crit ? 1 : 0),
      xp: s.xp + clickXp + KILL_XP,
      tags: spoil.tags,
      past: spoil.past,
      gallery: spoil.gallery,
      defeated: spoil.defeated,
      pendingDrops: spoil.pendingDrops,
      queue: filled.queue,
      grid: filled.grid,
    }
    next.toasts = pushToast(next, `Drained ${spoil.img.rarity} square (+${spoil.bonus} pts) — kept in gallery`)
    set({
      points: next.points,
      totalEarned: next.totalEarned,
      clicks: next.clicks,
      crits: next.crits,
      xp: next.xp,
      tags: next.tags,
      past: next.past,
      gallery: next.gallery,
      defeated: next.defeated,
      queue: next.queue,
      grid: next.grid,
      heatStreak: streak,
      lastClickAt: now,
      maxHeatStreak: Math.max(s.maxHeatStreak, streak),
      ...progress(next, s.xp),
    })
    if (filled.grid.length < gridSizeForMode(get().viewMode)) void get().fetchFeed()
    return { gain, crit, killed: true, heat }
  },

  dropCell: (index) => {
    const s = get()
    const cell = s.grid[index]
    if (!cell) return
    // Broken image: no reward, no KO — drop its bytes, slide a fresh foe in.
    void evictImage(cell.post.url)
    const target = gridSizeForMode(s.viewMode)
    const filled = fillGrid(
      s.grid.filter((_, i) => i !== index),
      s.queue,
      s.defeated,
      target,
    )
    set({
      past: pushPast(s.past, cell.post),
      queue: filled.queue,
      grid: filled.grid,
    })
    if (filled.grid.length < target && !get().fetching) void get().fetchFeed()
  },

  setViewMode: (mode) => {
    const s = get()
    if (!isGridMode(mode)) {
      if (s.viewMode !== mode) set({ viewMode: mode })
      return
    }
    const target = gridSizeForMode(mode)
    // Trim oversized boards when shrinking layouts; preserve order.
    const grid = s.grid.slice(0, target)
    const filled = fillGrid(grid, s.queue, s.defeated, target)
    set({ viewMode: mode, queue: filled.queue, grid: filled.grid })
    if (filled.grid.length < target && !get().fetching) void get().fetchFeed()
  },

  reorderGrid: (from, to) => {
    const s = get()
    if (from === to || from < 0 || to < 0 || from >= s.grid.length || to >= s.grid.length) return
    const grid = [...s.grid]
    const [cell] = grid.splice(from, 1)
    grid.splice(to, 0, cell)
    set({ grid })
  },

  claimDropTag: (id) => {
    const s = get()
    const drop = s.pendingDrops.find((d) => d.id === id)
    if (!drop?.suggestedTag) return false
    const name = drop.suggestedTag
    if (s.tags.some((t) => t.name.toLowerCase() === name)) {
      set({ pendingDrops: s.pendingDrops.filter((d) => d.id !== id) })
      return true
    }
    const stats = deriveTagStats(name, 1)
    const tags = [...s.tags, { name, level: 1, selected: true, ...stats }]
    set({ tags, pendingDrops: s.pendingDrops.filter((d) => d.id !== id) })
    get().save()
    return true
  },

  claimDropAntiTag: (id) => {
    const s = get()
    const drop = s.pendingDrops.find((d) => d.id === id)
    if (!drop?.suggestedAntiTag) return false
    const ok = get().addUserExclude(drop.suggestedAntiTag)
    set({ pendingDrops: get().pendingDrops.filter((d) => d.id !== id) })
    return ok
  },

  dismissDrop: (id) => {
    set((s) => ({ pendingDrops: s.pendingDrops.filter((d) => d.id !== id) }))
  },

  buyTag: (name) => {
    const s = get()
    const idx = s.tags.findIndex((t) => t.name === name)
    if (idx === -1) return false
    const res = buyTagLevel(s.tags[idx], s.points)
    if (!res) return false
    const tags = [...s.tags]
    tags[idx] = res.tag
    const next = { ...s, tags, points: res.points }
    set({ tags, points: res.points, ...progress(next, s.xp) })
    return true
  },

  toggleTag: (name) => {
    const s = get()
    const idx = s.tags.findIndex((t) => t.name === name)
    if (idx === -1) return false
    const next = toggleTagLevel(s.tags[idx])
    if (!next) return false
    const tags = [...s.tags]
    tags[idx] = next
    // Intent changed: old-tag memo slots must not serve again.
    void clearFeedCache()
    if (next.selected === false) {
      // Deselected: drop its unseen tagged posts now (untagged posts can't
      // be attributed; gallery/past kept).
      const drop = (p: BooruPost) => postMatchesIntent(p, name) && p.tags.length > 0
      set({
        tags,
        queue: s.queue.filter((p) => !drop(p)),
        grid: s.grid.filter((c) => !drop(c.post)),
        current: s.current && drop(s.current) ? null : s.current,
      })
    } else {
      set({ tags })
    }
    return true
  },

  soloTag: (name) => {
    const next = soloTagList(get().tags, name)
    if (!next) return false
    // Intent narrowed to one tag: drop the old-tag memo, flush unseen
    // posts from every other tag, then refill from the solo tag at once.
    void clearFeedCache()
    const s = get()
    const keep = (p: BooruPost) => postMatchesIntent(p, name)
    set({
      tags: next,
      priorityTag: name,
      queue: s.queue.filter(keep),
      grid: s.grid.filter((c) => keep(c.post)),
      current: s.current && keep(s.current) ? s.current : null,
    })
    void get().fetchFeed()
    return true
  },

  deleteTag: (name) => {
    const s = get()
    const next = removeTagList(s.tags, name)
    if (!next) return false
    // Removal of a tag means removal of its cache: drop the memo and its
    // unseen posts now (gallery/past history and bytes kept).
    void clearFeedCache()
    const drop = (p: BooruPost) => postMatchesIntent(p, name) && p.tags.length > 0
    set({
      tags: next,
      toasts: pushToast(s, `Tag ${name} removed.`),
      queue: s.queue.filter((p) => !drop(p)),
      grid: s.grid.filter((c) => !drop(c.post)),
      current: s.current && drop(s.current) ? null : s.current,
    })
    return true
  },

  mergeTags: (a, b) => {
    const s = get()
    const next = mergeTagList(s.tags, a, b)
    if (!next) return false
    // Consumed pills are gone as queries: drop the memo (queued posts stay,
    // they still match the merged pair's content).
    void clearFeedCache()
    const name = `${a} ${b}`
    set({ tags: next, priorityTag: name, toasts: pushToast(s, `Merged into ${name} — combined search, best level kept.`) })
    return true
  },

  addCustomTag: async (raw) => {
    const verdict = validateCustomTag(raw)
    if (!verdict.ok) {
      const why =
        verdict.reason === 'empty'
          ? 'Type a tag first.'
          : verdict.reason === 'too-short'
            ? 'Tag too short.'
            : verdict.reason === 'too-long'
              ? 'Tag too long (40 max).'
              : verdict.reason === 'noise'
                ? 'That tag carries no content — try another.'
                : 'That tag is blocked — try another.'
      return { added: false, message: why }
    }
    const s = get()
    if (s.tags.some((t) => t.name.toLowerCase() === verdict.name)) {
      return { added: false, message: `Already have ${verdict.name}.` }
    }
    if (s.fetching) return { added: false, message: 'Hold on — feed is busy.' }
    set({ fetching: true })
    let probe: { ok: boolean; posts: { length: number } }
    try {
      // Silent validation: proving the tag serves must not mark its pool
      // seen (that would hide those pictures from the very feed being built).
      probe = await fetchPosts({ tags: verdict.name, limit: 20, page: 0, probe: true, silent: true })
    } finally {
      set({ fetching: false })
    }
    if (!probe.ok || probe.posts.length === 0) {
      return { added: false, message: `No live results for ${verdict.name} — check the spelling.` }
    }
    // Probing proved the feed serves it: own level 1 free, steering the feed.
    const owned: OwnedTag = { name: verdict.name, level: 1, selected: true, ...deriveTagStats(verdict.name, 1) }
    const snap = get()
    const next = { ...snap, tags: [...snap.tags, owned] }
    const prog = progress(next, s.xp)
    set({
      tags: next.tags,
      priorityTag: verdict.name,
      achievements: prog.achievements,
      toasts: [...prog.toasts, { id: toastSeq++, msg: `Custom tag added: ${verdict.name}` }],
    })
    return { added: true, message: `Added ${verdict.name} — steering the feed.` }
  },

  refreshTagMarket: async () => {
    const s = get()
    if (s.fetching) return
    set({ fetching: true })
    // Player-owned tags only — no hardcoded seeds. Nothing owned: the market
    // waits for setup picks, custom tags, or drained-foe discovery.
    const owned = feedQuery(s.tags)
    if (owned.length === 0) {
      set({ fetching: false })
      return
    }
    const q = buildRoundQueries({ pills: owned, count: 1 })
    if (q.length === 0) {
      set({ fetching: false })
      return
    }
    // Silent: market discovery must not mark the pool seen — those pictures
    // still belong to future feed rounds.
    const res = await fetchPosts({ tags: q[0], limit: 60, silent: true })
    const prev = new Map(s.tags.map((t) => [t.name, t]))
    let offers: OwnedTag[]
    if (res.ok && res.posts.length > 0) {
      offers = rankTags(res.posts.flatMap((p) => p.tags))
        .slice(0, 24)
        .map(({ name, frequency }) => {
          const old = prev.get(name)
          return {
            name,
            level: old?.level ?? 0,
            selected: old ? old.selected ?? old.level > 0 : false,
            ...deriveTagStats(name, frequency),
          }
        })
    } else {
      // Feed down: keep the current market as-is (owned tags always kept below).
      offers = s.tags.filter((t) => t.level === 0)
    }
    const keptOwned = s.tags.filter(
      (t) => t.level > 0 && !offers.some((o) => o.name === t.name),
    )
    set({ tags: [...offers, ...keptOwned], fetching: false })
  },

  toggleFeedCategory: (cat: 'real' | 'hentai') => {
    const s = get()
    let nextReal = s.allowReal
    let nextHentai = s.allowHentai
    if (cat === 'real') {
      nextReal = !s.allowReal
    } else {
      nextHentai = !s.allowHentai
    }
    if (!nextReal && !nextHentai) {
      if (cat === 'real') nextReal = true
      else nextHentai = true
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('gmatch.feed.allowReal', nextReal ? '1' : '0')
        localStorage.setItem('gmatch.feed.allowHentai', nextHentai ? '1' : '0')
      }
    } catch { /* ignore */ }
    set({ allowReal: nextReal, allowHentai: nextHentai, queue: [] })
    void get().fetchFeed()
  },

  fetchFeed: async (opts?: { manual?: boolean }) => {
    const s = get()
    if (s.fetching) return
    if (opts?.manual) {
      // Manual retry starts clean: cancel pending auto-timer, reset backoff,
      // lift mirror cooldowns. First click must work when sources are up.
      clearFeedRetry()
      clearMirrorCooldowns()
    }
    set({ fetching: true })
    let cursor = s.feedCursor
    let posts: BooruPost[] | null = null
    // Seen-exhausted (not broken): gentle path — no backoff escalation,
    // distinct UI copy; auto-poll still recovers.
    let emptyFreshRound = false
    // Player-owned sources first: custom URLs / local folders need no tags,
    // so they also feed fresh setups. Built-ins stay as the fallback.
    const customs = (s.customSources || []).filter((c) => c.enabled)
    if (customs.length > 0) {
      const customPosts = await sampleCustomSources(customs, 10)
      if (customPosts.length > 0) posts = shufflePosts(customPosts)
    }
    if (!posts) {
      const owned = feedQuery(s.tags)
      // Round-robin: ONE player-owned tag per fetch, rotating. No owned tags
      // (setup not done / melted): stay offline — setup picks drive the feed.
      if (owned.length === 0) {
        set({
          current: null,
          queue: [],
          grid: [],
          foeHp: 0,
          foeMaxHp: 0,
          foeClicks: 0,
          feedOffline: true,
          fetching: false,
        })
        return
      }
      // Smart rotation: a random single-pill subset every round (merged
      // pills stay intact — combos exist ONLY via merge). Recent round keys
      // are refused, so consecutive rounds never repeat queries. A fresh
      // pick/solo (priorityTag) force-steers its round, then decays back
      // into the mix once its batch lands.
      const force = s.priorityTag && owned.includes(s.priorityTag) ? s.priorityTag : null
      const picks = buildRoundQueries({
        pills: owned,
        count: Math.min(PILLS_PER_ROUND, owned.length),
        forceInclude: force,
        recentKeys: s.recentQueryKeys,
      })
      setFeedIntent(picks)
      set({ recentQueryKeys: [...s.recentQueryKeys, roundQueryKey(picks)].slice(-RECENT_QUERY_DEPTH) })
      const priority = force
      // ponytail: in grid mode pull a larger batch (30) so queue stays ahead of the 3x3 grid
      const batchLimit = isGridMode(get().viewMode) ? 30 : 15
      const res = await fetchPostsMulti({ tags: picks, limit: batchLimit, priority, allowReal: s.allowReal, allowHentai: s.allowHentai, fresh: true })
      // Dev-only round trace: which query won which source (wrong-tag
      // reports become a one-line answer). Stripped from prod builds and
      // silent under vitest.
      if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
        console.debug(`[feed] picks=${picks.join('+')} source=${res.source} posts=${res.posts.length} ok=${res.ok}`)
      }
      cursor = s.feedCursor + 1
      // Seen-exhausted (not broken): gentle path — no backoff escalation,
      // distinct UI copy; auto-poll still recovers.
      if (!res.ok && (res as { emptyFresh?: boolean }).emptyFresh === true) {
        emptyFreshRound = true
      }
      if (res.ok && res.posts.length > 0) {
        // Random order every round — never push API sequence straight to the feed.
        posts = shufflePosts(res.posts)
        if (priority) set({ priorityTag: null })
      }
    }
    if (posts && posts.length > 0) {
      // Success: clear the offline flag + reset the retry backoff.
      clearFeedRetry()
      const foe = foeMaxHp(s.defeated)
      // Filter any post already known (queue/grid/past/gallery/current): never repeat
      const existingUrls = new Set([
        ...get().past.map((p) => p.url),
        ...get().gallery.map((g) => g.url),
        ...get().grid.map((c) => c.post.url),
        ...get().queue.map((p) => p.url),
        ...(get().current ? [get().current!.url] : []),
      ])
      const freshPosts = posts.filter((p) => !existingUrls.has(p.url))
      // # ponytail: skip seen posts completely; never repeat into usablePosts
      const usablePosts = freshPosts
      if (usablePosts.length > 0) {
        if (isGridMode(get().viewMode)) {
          // Grid consumes the whole batch: append to the queue, top up squares.
          const target = gridSizeForMode(get().viewMode)
          const q = [...get().queue, ...usablePosts]
          const filled = fillGrid(get().grid, q, get().defeated, target)
          set({
            queue: filled.queue,
            grid: filled.grid,
            feedCursor: cursor,
            feedOffline: false,
            feedEmptyFresh: false,
            fetching: false,
          })
          return
        }
        set({
          current: usablePosts[0],
          queue: usablePosts.slice(1),
          foeHp: foe,
          foeMaxHp: foe,
          foeClicks: 0,
          feedCursor: cursor,
          feedOffline: false,
          feedEmptyFresh: false,
          fetching: false,
        })
      } else {
        scheduleFeedRetry()
        set({ fetching: false })
      }
    } else {
      // Sources unreachable or pool exhausted: keep the game playable.
      // Seen-exhausted polls gently (fixed 5s, no escalation, no cursor
      // advance) since recovery just needs new tags, not backoff.
      if (emptyFreshRound) scheduleFeedRetry(true)
      else scheduleFeedRetry()
      if (isGridMode(get().viewMode)) {
        // Only use live, unseen queue posts — never recycle past.
        const target = gridSizeForMode(get().viewMode)
        const filled = fillGrid(get().grid, get().queue, get().defeated, target)
        set({
          fetching: false,
          feedOffline: filled.grid.length === 0,
          feedEmptyFresh: emptyFreshRound,
          grid: filled.grid,
          queue: filled.queue,
        })
      } else {
        const keep = get().current
        set({
          current: keep,
          queue: get().queue, // NEVER pull from past
          foeHp: keep ? get().foeHp : 0,
          foeMaxHp: keep ? get().foeMaxHp : 0,
          foeClicks: keep ? get().foeClicks : 0,
          feedOffline: !keep && get().queue.length === 0,
          feedEmptyFresh: emptyFreshRound,
          fetching: false,
        })
      }
    }
  },

  /** Manual retry from any Retry button: clean slate, then fetch. */
  retryFeedManual: () => {
    clearFeedRetry()
    clearMirrorCooldowns()
    void get().fetchFeed({ manual: true })
  },

  advanceFeed: () => {
    const s = get()
    if (s.current) void evictImage(s.current.url)
    if (s.queue.length > 0) {
      // Skipping is free but pays nothing — the beaten-or-not choice is the player's.
      // The skipped foe stays reachable via the back arrow at full HP.
      const foe = foeMaxHp(s.defeated)
      set({
        current: s.queue[0],
        queue: s.queue.slice(1),
        past: pushPast(s.past, s.current),
        foeHp: foe,
        foeMaxHp: foe,
        foeClicks: 0,
        feedOffline: false,
      })
    } else {
      if (s.current) set({ past: pushPast(s.past, s.current) })
      void s.fetchFeed()
    }
  },

  goBack: () => {
    const s = get()
    if (s.past.length === 0) return false
    const prev = s.past[s.past.length - 1]
    // Forward stays intact: the current image waits at the queue front.
    const queue = s.current ? [s.current, ...s.queue] : s.queue
    // Beaten foes (in the gallery) come back with no battle, like re-features.
    const beaten = s.gallery.some((g) => g.url === prev.url)
    const foe = beaten ? 0 : foeMaxHp(s.defeated)
    set({
      past: s.past.slice(0, -1),
      current: prev,
      queue,
      foeHp: foe,
      foeMaxHp: foe,
      foeClicks: 0,
      feedOffline: false,
    })
    return true
  },

  skipGrid: () => {
    const s = get()
    if (!isGridMode(s.viewMode) || s.grid.length === 0) return
    for (const c of s.grid) void evictImage(c.post.url)
    const gridPast = [...s.gridPast, s.grid].slice(-GRID_HISTORY_CAP)
    // Fresh board: every square refills from the queue head (fetch tops up).
    const target = gridSizeForMode(s.viewMode)
    const filled = fillGrid([], s.queue, s.defeated, target)
    set({ grid: filled.grid, queue: filled.queue, gridPast, feedOffline: false })
    // ponytail: refill when board has gaps OR queue falls below 2 boards ahead (18)
    if ((filled.grid.length < target || filled.queue.length < target * 2) && !s.fetching) void s.fetchFeed()
  },

  purgePost: (post) => {
    const s = get()
    void evictImage(post.url)
    // Pull it off-screen instantly; the queue head refills if one exists.
    if (s.current && s.current.id === post.id) set({ current: s.queue[0] ?? null, queue: s.queue.slice(1) })
    if (isGridMode(s.viewMode)) set({ grid: s.grid.filter((c) => c.post.id !== post.id) })
    // Learn: the 3 rarest content tags become anti-tags, but never a tag the
    // player is actively feeding on (intent beats the algorithm).
    const feed = new Set(feedQuery(s.tags))
    const content = rankTags(post.tags)
      .map((t) => t.name)
      .filter((t) => !isNoise(t) && !feed.has(t))
    const learn = content.filter((t) => !s.userExcludes.includes(t)).slice(0, 3)
    for (const t of learn) get().addUserExclude(t)
    // Pairs are learned from ALL content tags (not just the newly excluded
    // ones): the co-occurrence gate fires at count>=2 even if intent later
    // frees a tag from exclusion.
    const coRules = learnPurge(content.slice(0, 6), get().coRules)
    setCoRules(coRules)
    const cur = get()
    set({ coRules, toasts: pushToast(cur, learn.length ? `Purged — excluded: ${learn.join(', ')}` : 'Purged — will not return.') })
    cur.save()
  },

  undoGrid: () => {
    const s = get()
    if (s.gridPast.length === 0) return false
    const prev = s.gridPast[s.gridPast.length - 1]
    set({ grid: prev, gridPast: s.gridPast.slice(0, -1), feedOffline: false })
    return true
  },

  featureImage: (id) => {
    const s = get()
    const img = s.gallery.find((g) => g.id === id)
    if (!img) return
    // Already beaten: re-featuring shows it with no HP bar and no battle.
    set({
      current: { id: img.id, url: img.url, tags: img.tags, kind: img.kind, preview: img.preview },
      foeHp: 0,
      foeMaxHp: 0,
      foeClicks: 0,
      feedOffline: false,
    })
  },

  setBackground: (url) => {
    set({ backgroundUrl: url })
  },

  /** Permanently delete a keepsake from the gallery (never blocks play). */
  removeGalleryImage: (id) => {
    const s = get()
    const img = s.gallery.find((g) => g.id === id)
    if (!img) return false
    const gallery = s.gallery.filter((g) => g.id !== id)
    set({
      gallery,
      backgroundUrl: s.backgroundUrl === img.url ? null : s.backgroundUrl,
    })
    // Vault (opt-in): unpin + delete the bytes — gone means gone.
    if (img.url) {
      vaultUnpin(img.url)
      vaultRemove(img.url)
    }
    get().save()
    return true
  },

  popCap: (capId) => {
    const s = get()
    const def = CAPS[capId]
    if (s.points < def.cost) return false
    const now = Date.now()
    const next: GameState = {
      ...s,
      points: s.points - def.cost,
      caps: popCapList(activeCaps(s.caps, now), capId, now),
      capsUsed: s.capsUsed.includes(capId) ? s.capsUsed : [...s.capsUsed, capId],
    }
    next.toasts = pushToast(
      next,
      `${def.name} popped — permanent`,
    )
    set({
      points: next.points,
      caps: next.caps,
      capsUsed: next.capsUsed,
      ...progress(next, s.xp),
    })
    return true
  },

  brainmelt: () => {
    const s = get()
    if (!canBrainmelt(tierForXp(s.xp))) return false
    const out = applyBrainmelt({
      points: s.points,
      totalEarned: s.totalEarned,
      xp: s.xp,
      tags: s.tags,
      caps: s.caps,
      gallery: s.gallery,
      shards: s.shards,
      achievements: s.achievements,
      prestigeCount: s.prestigeCount,
    })
    const next: GameState = {
      ...s,
      points: 0,
      totalEarned: 0,
      xp: 0,
      tags: [],
      caps: [],
      shards: out.shards,
      prestigeCount: out.prestigeCount,
    }
    next.toasts = pushToast(next, `BRAINMELT — +${out.shardsGained} corruption shards`)
    set({
      points: 0,
      totalEarned: 0,
      xp: 0,
      tags: [],
      caps: [],
      shards: out.shards,
      prestigeCount: out.prestigeCount,
      ...progress(next, s.xp),
    })
    return true
  },

  tick: (dtMs = 1000) => {
    const s = get()
    const now = Date.now()
    const caps = activeCaps(s.caps, now)
    const input: EconomyInput = { ...econ(s), caps }
    const gps = passiveGps(input, now)
    const auto = capAutoClicksPerSec(caps, now)
    const gain = (gps + clickPower(input, now) * auto) * (dtMs / 1000)

    // Passive points income remains, but HP damage and KO only happen via active user clicks.
    set({
      caps,
      points: s.points + gain,
      totalEarned: s.totalEarned + gain,
      xp: s.xp + gain * 0.01,
      lastSeenAt: now,
      ...progress({ ...s, points: s.points + gain }, s.xp),
    })
  },

  save: () => {
    const s = get()
    const now = Date.now()
    const data: SaveData = {
      ...defaultSave(now),
      version: SAVE_VERSION,
      points: s.points,
      totalEarned: s.totalEarned,
      xp: s.xp,
      clickCount: s.clicks,
      critCount: s.crits,
      shards: s.shards,
      prestigeCount: s.prestigeCount,
      tags: s.tags,
      gallery: s.gallery,
      caps: activeCaps(s.caps, now),
      capsUsed: s.capsUsed,
      achievements: s.achievements,
      collectedOfflineEarnings: s.collectedOfflineEarnings,
      ageAccepted: s.ageVerified,
      defeated: s.defeated,
      maxHeatStreak: Math.max(s.maxHeatStreak, s.heatStreak),
      backgroundUrl: s.backgroundUrl,
      viewMode: s.viewMode,
      setupComplete: s.setupComplete,
      userExcludes: s.userExcludes,
      coRules: s.coRules,
      customSources: s.customSources,
      allowReal: s.allowReal,
      allowHentai: s.allowHentai,
      lastSeenAt: now,
    }
    writeStorage(serialize(data))
    set({ lastSaved: now, lastSeenAt: now })
  },

  load: () => {
    const s = get()
    if (s.loaded) return
    const d = deserialize(readStorage()) ?? defaultSave()
    const now = Date.now()
    // No fallback offers: the player's own picks (or nothing) drive the feed.
    const tags = d.tags
    const userExcludes = d.userExcludes
    setUserExcludes(userExcludes)
    setCoRules(d.coRules)
    // JSON turns Infinity into null — restore permanent pops; legacy timed
    // entries keep their expiry and prune via activeCaps as before.
    const caps = activeCaps(
      d.caps.map((c) => ({
        ...c,
        expiresAt: Number.isFinite(c.expiresAt) ? c.expiresAt : Number.POSITIVE_INFINITY,
      })),
      now,
    )
    const gps = passiveGps(
      {
        shards: d.shards,
        achievementsEarned: d.achievements.length,
        tags,
        gallery: d.gallery,
        caps,
      },
      now,
    )
    const gain = d.ageAccepted ? offlineEarnings(gps, now - d.lastSeenAt) : 0
    set({
      loaded: true,
      points: d.points,
      totalEarned: d.totalEarned,
      xp: d.xp,
      clicks: d.clickCount,
      crits: d.critCount,
      shards: d.shards,
      prestigeCount: d.prestigeCount,
      tags,
      setupComplete: d.setupComplete,
      userExcludes,
      coRules: d.coRules,
      customSources: d.customSources,
      allowReal: d.allowReal !== false,
      allowHentai: d.allowHentai !== false,
      gallery: d.gallery,
      caps,
      capsUsed: d.capsUsed,
      past: [],
      achievements: d.achievements,
      collectedOfflineEarnings: d.collectedOfflineEarnings,
      ageVerified: d.ageAccepted,
      defeated: d.defeated,
      maxHeatStreak: d.maxHeatStreak,
      backgroundUrl: d.backgroundUrl,
      viewMode: d.viewMode,
      lastSeenAt: now,
      offlineGain: gain >= 1 ? gain : 0,
    })
  },

  collectOffline: () => {
    const s = get()
    if (s.offlineGain <= 0) return
    const next: GameState = {
      ...s,
      points: s.points + s.offlineGain,
      totalEarned: s.totalEarned + s.offlineGain,
      xp: s.xp + s.offlineGain * 0.01,
      collectedOfflineEarnings: true,
      offlineGain: 0,
    }
    set({
      points: next.points,
      totalEarned: next.totalEarned,
      xp: next.xp,
      collectedOfflineEarnings: true,
      offlineGain: 0,
      ...progress(next, s.xp),
    })
  },

  verifyAge: () => {
    set({ ageVerified: true })
    get().save()
  },

  completeSetup: (names, excludes) => {
    if (get().setupComplete) return { ok: false, message: 'Setup already done.' }
    return get().updateSetup(names, excludes)
  },

  updateSetup: (names, excludes) => {
    const s = get()
    // Validity gate only (no network): exactly SETUP_TAG_COUNT unique live
    // probing happens on the setup screen before this is called.
    const clean: string[] = []
    for (const raw of names) {
      const verdict = validateCustomTag(raw)
      if (!verdict.ok) return { ok: false, message: `“${raw}” is not usable — pick another.` }
      if (!clean.includes(verdict.name)) clean.push(verdict.name)
    }
    if (clean.length !== SETUP_TAG_COUNT) {
      return { ok: false, message: `Pick exactly ${SETUP_TAG_COUNT} tags.` }
    }
    // Re-select starter tags without discarding purchased levels: keep any
    // already-owned tag's level/stats (flipping feed selection), add fresh
    // picks at level 1, and retain previously-owned (leveled) tags that are no
    // longer starters as owned-but-unselected so income is never lost.
    const prevTags = new Map(s.tags.map((t) => [t.name, t]))
    const pickedNames = new Set(clean)
    const picked: OwnedTag[] = clean.map((name) => {
      const existing = prevTags.get(name)
      return existing ? { ...existing, selected: true } : setupTag(name)
    })
    for (const t of s.tags) {
      if (!pickedNames.has(t.name) && t.level > 0) picked.push({ ...t, selected: false })
    }
    setUserExcludes(excludes.slice(0, MAX_USER_EXCLUDES))
    const next = { ...s, tags: picked, setupComplete: true, userExcludes: getUserExcludes() }
    const prog = progress(next, s.xp)
    set({
      tags: picked,
      setupComplete: true,
      priorityTag: clean[clean.length - 1] ?? null,
      userExcludes: next.userExcludes,
      achievements: prog.achievements,
      toasts: [...prog.toasts, { id: toastSeq++, msg: `Feed tuned: ${clean.join(', ')}` }],
    })
    get().save()
    return { ok: true, message: `Feed tuned — ${clean.length} starters set.` }
  },

  addUserExclude: (raw) => {
    const t = String(raw).toLowerCase().trim()
    if (!t || t.length > 40) return false
    const s = get()
    if (s.userExcludes.includes(t) || s.userExcludes.length >= MAX_USER_EXCLUDES) return false
    const next = [...s.userExcludes, t]
    setUserExcludes(next)
    set({ userExcludes: getUserExcludes() })
    get().save()
    return true
  },

  removeUserExclude: (term) => {
    const t = String(term).toLowerCase().trim()
    const s = get()
    if (!s.userExcludes.includes(t)) return false
    const next = s.userExcludes.filter((x) => x !== t)
    setUserExcludes(next)
    set({ userExcludes: getUserExcludes() })
    get().save()
    return true
  },

  /** Cap: 20 sources, 500 URLs each (enforced again at load). */
  addUrlSource: (label, rawUrls) => {
    const clean = [...new Set(rawUrls.map((u) => String(u).trim()).filter((u) => u && isCustomMediaUrl(u)))].slice(0, 500)
    if (clean.length === 0) return { added: false, message: 'No usable image/video links — paste direct http(s) media URLs.' }
    const s = get()
    if (s.customSources.length >= 20) return { added: false, message: 'Source limit reached (20) — remove one first.' }
    const source: CustomSource = {
      id: `u${Date.now().toString(36)}`,
      label: label.trim().slice(0, 60) || 'Custom links',
      kind: 'urls',
      enabled: true,
      urls: clean,
      folderId: null,
      folderPath: null,
      addedAt: Date.now(),
    }
    set({ customSources: [...s.customSources, source] })
    get().save()
    return { added: true, message: `Added “${source.label}” (${clean.length} links).` }
  },

  addFolderSource: (folderId, folderPath, label) => {
    const s = get()
    if (s.customSources.some((c) => c.kind === 'folder' && c.folderId === folderId)) {
      return { added: false, message: 'That folder is already a source.' }
    }
    if (s.customSources.length >= 20) return { added: false, message: 'Source limit reached (20) — remove one first.' }
    const base = String(folderPath).split(/[/\\]/).filter(Boolean).pop() || 'Local folder'
    const source: CustomSource = {
      id: `f${Date.now().toString(36)}`,
      label: (label || '').trim().slice(0, 60) || base.slice(0, 60),
      kind: 'folder',
      enabled: true,
      urls: [],
      folderId,
      folderPath: String(folderPath),
      addedAt: Date.now(),
    }
    set({ customSources: [...s.customSources, source] })
    get().save()
    return { added: true, message: `Added folder “${source.label}”.` }
  },

  removeCustomSource: (id) => {
    const s = get()
    const doomed = s.customSources.find((c) => c.id === id)
    set({ customSources: s.customSources.filter((c) => c.id !== id) })
    if (doomed?.kind === 'folder' && doomed.folderId && typeof window !== 'undefined') {
      void window.gmatch?.customRemoveFolder?.(doomed.folderId).catch(() => {})
    }
    get().save()
  },

  toggleCustomSource: (id) => {
    const s = get()
    set({ customSources: s.customSources.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) })
    get().save()
  },

  notify: (msg) => {
    const s = get()
    set({ toasts: pushToast(s, msg) })
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clearToasts: () => set({ toasts: [] }),

  resetGame: () => {
    setUserExcludes([])
    clearSeenMemory()
    set({ ...freshData() })
  },
}))
