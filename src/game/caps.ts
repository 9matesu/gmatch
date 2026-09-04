import type { ActiveCap, CapId } from './types'

export interface CapDef {
  id: CapId
  name: string
  cost: number
  clickMult: number
  passiveMult: number
  autoClicksPerSec: number
}

/** GoonCaps vending machine (SPEC §5). Pops are PERMANENT — no timers, no wear. */
export const CAPS: Record<CapId, CapDef> = {
  blue: {
    id: 'blue',
    name: 'Blue Cap',
    cost: 150,
    clickMult: 2,
    passiveMult: 1,
    autoClicksPerSec: 0,
  },
  filter: {
    id: 'filter',
    name: 'Goon Filter',
    cost: 900,
    clickMult: 1,
    passiveMult: 1,
    autoClicksPerSec: 1,
  },
  hypno: {
    id: 'hypno',
    name: 'Hypno Drop',
    cost: 5_000,
    clickMult: 1,
    passiveMult: 2,
    autoClicksPerSec: 0,
  },
  melt: {
    id: 'melt',
    name: 'Brain Melt',
    cost: 50_000,
    clickMult: 10,
    passiveMult: 10,
    autoClicksPerSec: 0,
  },
}

export const ALL_CAP_IDS: readonly CapId[] = ['blue', 'filter', 'hypno', 'melt']

/**
 * Pop a cap: EVERY pop stacks permanently — same-id pops add another live
 * entry so multipliers compound (click/passive) and auto-click rates add up
 * (SPEC §5). Nothing expires; activeCaps only prunes legacy timed entries
 * from old saves.
 */
export function popCap(active: ActiveCap[], capId: CapId, now: number): ActiveCap[] {
  void now
  return [...active, { capId, expiresAt: Number.POSITIVE_INFINITY }]
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

/** Live stack count for one cap id. Pops never expire, so no time math. */
export function capStacks(
  active: ActiveCap[],
  capId: CapId,
  now: number,
): { count: number } {
  void now
  return { count: active.filter((a) => a.capId === capId).length }
}
