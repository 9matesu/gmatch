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
 * Pop a cap: different caps stack; same cap refreshes duration (SPEC §5).
 */
export function popCap(active: ActiveCap[], capId: CapId, now: number): ActiveCap[] {
  const def = CAPS[capId]
  return [
    ...active.filter((a) => a.capId !== capId),
    { capId, expiresAt: now + def.durationMs },
  ]
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
