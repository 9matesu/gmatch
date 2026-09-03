import { create } from 'zustand'
import { clickGain, clickPower, isCrit, passiveGps } from './economy'
import type { EconomyInput } from './economy'
import { buyTag as buyTagLevel, deriveTagStats, feedQuery, starterOffers } from './tags'
import { rankTags } from './tagFilter'
import { pervertSeeds } from './pervertTags'
import { KILL_XP, foeMaxHp, killBonusGp } from './battle'
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
import { fetchPosts } from '../services/booru'
import type { ActiveCap, BooruPost, CapId, GalleryImage, OwnedTag } from './types'

export interface Toast {
  id: number
  msg: string
}

export interface ClickResult {
  gain: number
  crit: boolean
  killed: boolean
}

export interface GameState {
  loaded: boolean
  gp: number
  totalEarnedGP: number
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
  /** Live foe: HP left / max, clicks landed, lifetime KOs. max 0 = no battle. */
  foeHp: number
  foeMaxHp: number
  foeClicks: number
  defeated: number
  feedOffline: boolean
  fetching: boolean
  toasts: Toast[]
  offlineGain: number

  clickImage: () => ClickResult
  buyTag: (name: string) => boolean
  refreshTagMarket: () => Promise<void>
  fetchFeed: () => Promise<void>
  advanceFeed: () => void
  featureImage: (id: string) => void
  popCap: (capId: CapId) => boolean
  brainmelt: () => boolean
  tick: (dtMs?: number) => void
  save: () => void
  load: () => void
  collectOffline: () => void
  verifyAge: () => void
  dismissToast: (id: number) => void
  resetGame: () => void
}

let toastSeq = 1

function readStorage(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null
  } catch {
    return null
  }
}

function writeStorage(raw: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SAVE_KEY, raw)
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
  }
}

function pushToast(s: GameState, msg: string): Toast[] {
  return [...s.toasts, { id: toastSeq++, msg }]
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
    gp: 0,
    totalEarnedGP: 0,
    xp: 0,
    clicks: 0,
    crits: 0,
    tags: starterOffers(),
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
    foeHp: 0,
    foeMaxHp: 0,
    foeClicks: 0,
    defeated: 0,
    feedOffline: false,
    fetching: false,
    toasts: [] as Toast[],
    offlineGain: 0,
  }
}

/**
 * Drain a foe into the gallery. Shared by manual clicks and auto-click ticks.
 * Caller supplies the state snapshot and clicks landed on this foe.
 */
function koFoe(s: GameState, now: number, clicksOnFoe: number) {
  const post = s.current as BooruPost
  const defeated = s.defeated + 1
  const rarityBase = rarityBaseForPost(post.id)
  const bonus = killBonusGp(rarityBase)
  const img: GalleryImage = {
    id: `${post.id}:${now}`,
    url: post.url,
    tags: post.tags,
    rarityBase,
    clicks: clicksOnFoe,
    rarity: imageRarity(rarityBase, s.gallery.length, clicksOnFoe),
    boughtAt: now,
  }
  const current = s.queue[0] ?? null
  const queue = s.queue.slice(1)
  // Harder with each KO: the next foe scales off the new lifetime total.
  const foe = current ? foeMaxHp(defeated) : 0
  return {
    defeated,
    bonus,
    img,
    gallery: [...s.gallery, img],
    current,
    queue,
    foeHp: foe,
    foeMaxHp: foe,
    foeClicks: 0,
  }
}

export const useGame = create<GameState>((set, get) => ({
  ...freshData(),

  clickImage: () => {
    const s = get()
    const now = Date.now()
    const clickNumber = s.clicks + 1
    const crit = isCrit(clickNumber)
    // Damage equals the click's GP gain — store power-ups (caps, shards,
    // achievements) hit harder, crits deal x10.
    const gain = clickGain(econ(s), clickNumber, now)
    const clickXp = crit ? 5 : 1
    // No live foe (empty feed or re-featured gallery piece): clicks just pay GP.
    if (!s.current || s.foeMaxHp <= 0) {
      const next: GameState = {
        ...s,
        gp: s.gp + gain,
        totalEarnedGP: s.totalEarnedGP + gain,
        clicks: clickNumber,
        crits: s.crits + (crit ? 1 : 0),
        xp: s.xp + clickXp,
      }
      set({
        gp: next.gp,
        totalEarnedGP: next.totalEarnedGP,
        clicks: next.clicks,
        crits: next.crits,
        xp: next.xp,
        ...progress(next, s.xp),
      })
      return { gain, crit, killed: false }
    }
    const clicksOnFoe = s.foeClicks + 1
    const hpLeft = s.foeHp - gain
    if (hpLeft > 0) {
      const next: GameState = {
        ...s,
        gp: s.gp + gain,
        totalEarnedGP: s.totalEarnedGP + gain,
        clicks: clickNumber,
        crits: s.crits + (crit ? 1 : 0),
        xp: s.xp + clickXp,
        foeHp: hpLeft,
        foeClicks: clicksOnFoe,
      }
      set({
        gp: next.gp,
        totalEarnedGP: next.totalEarnedGP,
        clicks: next.clicks,
        crits: next.crits,
        xp: next.xp,
        foeHp: next.foeHp,
        foeClicks: next.foeClicks,
        ...progress(next, s.xp),
      })
      return { gain, crit, killed: false }
    }
    // KO: the drained foe joins the gallery with a GP kill bonus.
    const ko = koFoe(s, now, clicksOnFoe)
    const next: GameState = {
      ...s,
      gp: s.gp + gain + ko.bonus,
      totalEarnedGP: s.totalEarnedGP + gain + ko.bonus,
      clicks: clickNumber,
      crits: s.crits + (crit ? 1 : 0),
      xp: s.xp + clickXp + KILL_XP,
      gallery: ko.gallery,
      defeated: ko.defeated,
      current: ko.current,
      queue: ko.queue,
      foeHp: ko.foeHp,
      foeMaxHp: ko.foeMaxHp,
      foeClicks: ko.foeClicks,
    }
    next.toasts = pushToast(next, `Drained ${ko.img.rarity} foe (+${ko.bonus} GP) — kept in gallery`)
    set({
      gp: next.gp,
      totalEarnedGP: next.totalEarnedGP,
      clicks: next.clicks,
      crits: next.crits,
      xp: next.xp,
      gallery: next.gallery,
      defeated: next.defeated,
      current: next.current,
      queue: next.queue,
      foeHp: next.foeHp,
      foeMaxHp: next.foeMaxHp,
      foeClicks: next.foeClicks,
      ...progress(next, s.xp),
    })
    if (!ko.current) void get().fetchFeed()
    return { gain, crit, killed: true }
  },

  buyTag: (name) => {
    const s = get()
    const idx = s.tags.findIndex((t) => t.name === name)
    if (idx === -1) return false
    const res = buyTagLevel(s.tags[idx], s.gp)
    if (!res) return false
    const tags = [...s.tags]
    tags[idx] = res.tag
    const next = { ...s, tags, gp: res.gp }
    set({ tags, gp: res.gp, ...progress(next, s.xp) })
    return true
  },

  refreshTagMarket: async () => {
    const s = get()
    if (s.fetching) return
    set({ fetching: true })
    const owned = feedQuery(s.tags)
    // Pervert seeds (user spec): always bias the market toward the hard pool.
    const q = owned.length > 0 ? [...owned.slice(0, 3), ...pervertSeeds(2)] : pervertSeeds(2)
    const res = await fetchPosts({ tags: q.join(' '), limit: 60 })
    const levelOf = new Map(s.tags.map((t) => [t.name, t.level]))
    let offers: OwnedTag[]
    if (res.ok && res.posts.length > 0) {
      offers = rankTags(res.posts.flatMap((p) => p.tags))
        .slice(0, 24)
        .map(({ name, frequency }) => ({
          name,
          level: levelOf.get(name) ?? 0,
          ...deriveTagStats(name, frequency),
        }))
    } else {
      offers = starterOffers().map((t) => ({ ...t, level: levelOf.get(t.name) ?? 0 }))
    }
    const keptOwned = s.tags.filter(
      (t) => t.level > 0 && !offers.some((o) => o.name === t.name),
    )
    set({ tags: [...offers, ...keptOwned], fetching: false })
  },

  fetchFeed: async () => {
    const s = get()
    if (s.fetching) return
    set({ fetching: true })
    const owned = feedQuery(s.tags)
    // Pervert seeds (user spec): the feed always carries hard tags, never vanilla.
    const q = owned.length > 0 ? [...owned.slice(0, 3), ...pervertSeeds(2)] : pervertSeeds(3)
    let res = await fetchPosts({ tags: q.join(' '), limit: 10 })
    if (!res.ok) {
      // Booru mirrors rate-limit / flake under volume — retry once with
      // fresh seeds before declaring the feed offline.
      const retryQ =
        owned.length > 0 ? [...owned.slice(0, 2), ...pervertSeeds(2)] : pervertSeeds(3)
      res = await fetchPosts({ tags: retryQ.join(' '), limit: 10 })
    }
    if (res.ok && res.posts.length > 0) {
      const foe = foeMaxHp(s.defeated)
      set({
        current: res.posts[0],
        queue: res.posts.slice(1),
        foeHp: foe,
        foeMaxHp: foe,
        foeClicks: 0,
        feedOffline: false,
        fetching: false,
      })
    } else {
      set({ current: null, queue: [], foeHp: 0, foeMaxHp: 0, foeClicks: 0, feedOffline: true, fetching: false })
    }
  },

  advanceFeed: () => {
    const s = get()
    if (s.queue.length > 0) {
      // Skipping is free but pays nothing — the beaten-or-not choice is the player's.
      const foe = foeMaxHp(s.defeated)
      set({
        current: s.queue[0],
        queue: s.queue.slice(1),
        foeHp: foe,
        foeMaxHp: foe,
        foeClicks: 0,
        feedOffline: false,
      })
    } else {
      void s.fetchFeed()
    }
  },

  featureImage: (id) => {
    const s = get()
    const img = s.gallery.find((g) => g.id === id)
    if (!img) return
    // Already beaten: re-featuring shows it with no HP bar and no battle.
    set({
      current: { id: img.id, url: img.url, tags: img.tags },
      foeHp: 0,
      foeMaxHp: 0,
      foeClicks: 0,
      feedOffline: false,
    })
  },

  popCap: (capId) => {
    const s = get()
    const def = CAPS[capId]
    if (s.gp < def.cost) return false
    const now = Date.now()
    const next: GameState = {
      ...s,
      gp: s.gp - def.cost,
      caps: popCapList(activeCaps(s.caps, now), capId, now),
      capsUsed: s.capsUsed.includes(capId) ? s.capsUsed : [...s.capsUsed, capId],
    }
    next.toasts = pushToast(
      next,
      `${def.name} popped — ${Math.round(def.durationMs / 1000)}s of chaos`,
    )
    set({
      gp: next.gp,
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
      gp: s.gp,
      totalEarnedGP: s.totalEarnedGP,
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
      gp: 0,
      totalEarnedGP: 0,
      xp: 0,
      tags: starterOffers(),
      caps: [],
      shards: out.shards,
      prestigeCount: out.prestigeCount,
    }
    next.toasts = pushToast(next, `BRAINMELT — +${out.shardsGained} corruption shards`)
    set({
      gp: 0,
      totalEarnedGP: 0,
      xp: 0,
      tags: starterOffers(),
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
    const autoDmg = clickPower(input, now) * auto * (dtMs / 1000)
    const gain = (gps + clickPower(input, now) * auto) * (dtMs / 1000)
    // Auto-clicks also batter the live foe (one KO per tick at most).
    if (s.current && s.foeMaxHp > 0 && autoDmg > 0 && s.foeHp - autoDmg <= 0) {
      const ko = koFoe(s, now, s.foeClicks)
      const next: GameState = {
        ...s,
        caps,
        gp: s.gp + gain + ko.bonus,
        totalEarnedGP: s.totalEarnedGP + gain + ko.bonus,
        xp: s.xp + gain * 0.01 + KILL_XP,
        gallery: ko.gallery,
        defeated: ko.defeated,
        current: ko.current,
        queue: ko.queue,
        foeHp: ko.foeHp,
        foeMaxHp: ko.foeMaxHp,
        foeClicks: ko.foeClicks,
        lastSeenAt: now,
      }
      next.toasts = pushToast(next, `Auto-drained ${ko.img.rarity} foe (+${ko.bonus} GP)`)
      set({
        caps: next.caps,
        gp: next.gp,
        totalEarnedGP: next.totalEarnedGP,
        xp: next.xp,
        gallery: next.gallery,
        defeated: next.defeated,
        current: next.current,
        queue: next.queue,
        foeHp: next.foeHp,
        foeMaxHp: next.foeMaxHp,
        foeClicks: next.foeClicks,
        lastSeenAt: next.lastSeenAt,
        ...progress(next, s.xp),
      })
      if (!ko.current) void get().fetchFeed()
      return
    }
    const next: GameState = {
      ...s,
      caps,
      gp: s.gp + gain,
      totalEarnedGP: s.totalEarnedGP + gain,
      xp: s.xp + gain * 0.01,
      foeHp: s.foeMaxHp > 0 ? Math.max(0, s.foeHp - autoDmg) : s.foeHp,
      lastSeenAt: now,
    }
    set({
      caps: next.caps,
      gp: next.gp,
      totalEarnedGP: next.totalEarnedGP,
      xp: next.xp,
      foeHp: next.foeHp,
      lastSeenAt: next.lastSeenAt,
      ...progress(next, s.xp),
    })
  },

  save: () => {
    const s = get()
    const now = Date.now()
    const data: SaveData = {
      ...defaultSave(now),
      version: SAVE_VERSION,
      gp: s.gp,
      totalEarnedGP: s.totalEarnedGP,
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
    const tags = d.tags.length > 0 ? d.tags : starterOffers()
    const caps = activeCaps(d.caps, now)
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
      gp: d.gp,
      totalEarnedGP: d.totalEarnedGP,
      xp: d.xp,
      clicks: d.clickCount,
      crits: d.critCount,
      shards: d.shards,
      prestigeCount: d.prestigeCount,
      tags,
      gallery: d.gallery,
      caps,
      capsUsed: d.capsUsed,
      achievements: d.achievements,
      collectedOfflineEarnings: d.collectedOfflineEarnings,
      ageVerified: d.ageAccepted,
      defeated: d.defeated,
      lastSeenAt: now,
      offlineGain: gain >= 1 ? gain : 0,
    })
  },

  collectOffline: () => {
    const s = get()
    if (s.offlineGain <= 0) return
    const next: GameState = {
      ...s,
      gp: s.gp + s.offlineGain,
      totalEarnedGP: s.totalEarnedGP + s.offlineGain,
      xp: s.xp + s.offlineGain * 0.01,
      collectedOfflineEarnings: true,
      offlineGain: 0,
    }
    set({
      gp: next.gp,
      totalEarnedGP: next.totalEarnedGP,
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

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  resetGame: () => set({ ...freshData() }),
}))
