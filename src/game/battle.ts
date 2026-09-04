/**
 * Feed battle: every feed image is a foe with HP. Clicks deal damage equal
 * to their GP gain (crits hit x10). Draining a foe sends it to the gallery
 * with a GP kill bonus. Skipping (Next image) gives nothing.
 * HP scales with lifetime KOs so each image is harder than the last.
 */

export const FOE_HP_BASE = 8
export const FOE_HP_GROWTH = 1.3
export const KILL_XP = 10

/** Max HP of the next foe given lifetime KOs. Strictly increasing. */
export function foeMaxHp(defeated: number): number {
  const k = Number.isFinite(defeated) ? Math.max(0, Math.floor(defeated)) : 0
  return Math.max(1, Math.ceil(FOE_HP_BASE * Math.pow(FOE_HP_GROWTH, k)))
}

/** GP bonus for draining a foe, from its deterministic rarity base. */
export function killBonusGp(rarityBase: number): number {
  return Math.max(1, Math.floor(rarityBase))
}
