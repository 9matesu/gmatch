import type { ActiveCap, CapId } from './types'

export interface CapDef {
  id: CapId
  name: string
  cost: number
  clickMult: number
}

/**
 * GoonCaps vending machine (SPEC §5). Pops are PERMANENT — no timers, no wear.
 *
 * Only CLICK caps are sold. `filter` (auto-click) and `hypno` (passive
 * multiplier) are kept as inert rows because old saves still carry their
 * ids: the lookup must never be `undefined` on a loaded save. They are not
 * in ALL_CAP_IDS, so nothing can buy them again.
 */
export const CAPS: Record<CapId, CapDef> = {
  blue: {
    id: 'blue',
    name: 'E-Girl Spit',
    cost: 150,
    clickMult: 2,
  },
  filter: {
    id: 'filter',
    name: 'Braceface',
    cost: 0,
    clickMult: 1,
  },
  hypno: {
    id: 'hypno',
    name: 'Pornmeat',
    cost: 0,
    clickMult: 1,
  },
  melt: {
    id: 'melt',
    name: 'Brain Drain',
    cost: 50_000,
    clickMult: 10,
  },
}

/** What the machine sells (the two that multiply a click). */
export const ALL_CAP_IDS: readonly CapId[] = ['blue', 'melt']

/**
 * Pop a cap: EVERY pop stacks permanently — same-id pops add another live
 * entry so the click multiplier compounds (SPEC §5). Nothing expires;
 * activeCaps only prunes legacy timed entries from old saves.
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

/** Short effect line for buttons: what this cap actually does. */
export function capEffectLabel(id: CapId): string {
  const d = CAPS[id]
  if (d.clickMult <= 1) return 'no effect'
  return `x${d.clickMult} click`
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
