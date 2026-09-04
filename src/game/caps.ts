import type { ActiveCap, CapId } from './types'

export interface CapDef {
  id: CapId
  name: string
  cost: number
  durationMs: number
  clickMult: number
  passiveMult: number
  autoClicksPerSec: number
}

/** GoonCaps vending machine (SPEC §5). */
export const CAPS: Record<CapId, CapDef> = {
  blue: {
    id: 'blue',
    name: 'Blue Cap',
    cost: 150,
    durationMs: 60_000,
    clickMult: 2,
    passiveMult: 1,
    autoClicksPerSec: 0,
  },
  filter: {
    id: 'filter',
    name: 'Goon Filter',
    cost: 900,
    durationMs: 120_000,
    clickMult: 1,
    passiveMult: 1,
    autoClicksPerSec: 1,
  },
  hypno: {
    id: 'hypno',
    name: 'Hypno Drop',
    cost: 5_000,
    durationMs: 180_000,
    clickMult: 1,
    passiveMult: 2,
    autoClicksPerSec: 0,
  },
  melt: {
    id: 'melt',
    name: 'Brain Melt',
    cost: 50_000,
    durationMs: 30_000,
    clickMult: 10,
    passiveMult: 10,
    autoClicksPerSec: 0,
  },
}

export const ALL_CAP_IDS: readonly CapId[] = ['blue', 'filter', 'hypno', 'melt']

/**
 * Pop a cap: EVERY pop stacks — same-id pops add another live entry so
 * multipliers compound (click/passive) and auto-click rates add up (SPEC §5).
 * Caller prunes expired entries (activeCaps) before/after; expiry is per pop.
 */
export function popCap(active: ActiveCap[], capId: CapId, now: number): ActiveCap[] {
  const def = CAPS[capId]
  return [...active, { capId, expiresAt: now + def.durationMs }]
}

export function activeCaps(active: ActiveCap[], now: number): ActiveCap[] {
  return active.filter((a) => a.expiresAt > now)
}

export function capClickMult(active: ActiveCap[], now: number): number {
  return activeCaps(active, now).reduce((m, a) => m * CAPS[a.capId].clickMult, 1)
}

export function capPassiveMult(active: ActiveCap[], now: number): number {
  return activeCaps(active, now).reduce((m, a) => m * CAPS[a.capId].passiveMult, 1)
}

export function capAutoClicksPerSec(active: ActiveCap[], now: number): number {
  return activeCaps(active, now).reduce((s, a) => s + CAPS[a.capId].autoClicksPerSec, 0)
}

/** Short effect line for buttons: what this cap actually does. */
export function capEffectLabel(id: CapId): string {
  const d = CAPS[id]
  const parts: string[] = []
  if (d.clickMult > 1) parts.push(`x${d.clickMult} click`)
  if (d.passiveMult > 1) parts.push(`x${d.passiveMult} passive`)
  if (d.autoClicksPerSec > 0) parts.push(`+${d.autoClicksPerSec} auto/s`)
  return parts.join(' · ')
}

/** Live stack count + longest remaining seconds for one cap id. */
export function capStacks(
  active: ActiveCap[],
  capId: CapId,
  now: number,
): { count: number; secsLeft: number } {
  const live = active.filter((a) => a.capId === capId && a.expiresAt > now)
  if (live.length === 0) return { count: 0, secsLeft: 0 }
  return {
    count: live.length,
    secsLeft: Math.ceil((Math.max(...live.map((a) => a.expiresAt)) - now) / 1000),
  }
}
