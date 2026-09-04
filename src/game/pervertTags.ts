/**
 * Hard-coded pervert tag pool (user spec): no vanilla, humans only.
 * Every tag here was probe-tested live against tbib+xbooru DAPI with
 * `rating:explicit` + negative anti-slop tags (branch fix/pervert-feed-quality).
 * Weighted: higher weight = picked more often as the pervert seed.
 */
export const PERVERT_TAGS: readonly { tag: string; weight: number }[] = [
  { tag: 'gangbang', weight: 5 },
  { tag: 'pregnant', weight: 4 },
  { tag: 'pregnancy', weight: 3 },
  { tag: 'impregnation', weight: 4 },
  { tag: 'breeding', weight: 4 },
  { tag: 'veiny_penis', weight: 4 },
  { tag: 'bulge', weight: 3 },
  { tag: 'stomach_bulge', weight: 3 },
  { tag: 'x-ray', weight: 3 },
  { tag: 'cervix_penetration', weight: 2 },
  { tag: 'ahegao', weight: 4 },
  { tag: 'facial', weight: 4 },
  { tag: 'cum_on_body', weight: 3 },
  { tag: 'gokkun', weight: 2 },
  { tag: 'deepthroat', weight: 4 },
  { tag: 'double_penetration', weight: 4 },
  { tag: 'triple_penetration', weight: 2 },
  { tag: 'spitroast', weight: 3 },
  { tag: 'anal', weight: 4 },
  { tag: 'double_anal', weight: 2 },
  { tag: 'creampie', weight: 5 },
  { tag: 'cum_in_pussy', weight: 3 },
  { tag: 'cum_in_mouth', weight: 3 },
  { tag: 'paizuri', weight: 3 },
  { tag: 'doggystyle', weight: 4 },
  { tag: 'group_sex', weight: 4 },
  { tag: 'orgy', weight: 4 },
  { tag: 'all_the_way_through', weight: 1 },
  { tag: 'lactation', weight: 3 },
  { tag: 'bondage', weight: 3 },
  { tag: 'bdsm', weight: 3 },
  { tag: 'exhibitionism', weight: 2 },
  { tag: 'public_use', weight: 2 },
  { tag: 'nipple_piercing', weight: 2 },
  { tag: 'clit_piercing', weight: 1 },
  { tag: 'unbirth', weight: 1 },
  { tag: 'eggs', weight: 1 },
  { tag: 'ovipositor', weight: 1 },
  { tag: 'mind_break', weight: 2 },
  { tag: 'eyes_rolling', weight: 2 },
  { tag: 'bbc', weight: 5 },
  { tag: 'black_cock', weight: 4 },
  { tag: 'interracial', weight: 3 },
  { tag: 'skylar_vox', weight: 3 },
  { tag: 'bimbo', weight: 3 },
  { tag: 'femdom', weight: 3 },
  { tag: 'goon_caption', weight: 3 },
  { tag: 'caption', weight: 2 },
]

export function weightedPick<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((n, i) => n + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

/** 1–3 distinct weighted pervert seeds for feed/market queries. */
export function pervertSeeds(n = 2): string[] {
  const pool = [...PERVERT_TAGS]
  const picks: string[] = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    const item = weightedPick(pool)
    pool.splice(pool.indexOf(item), 1)
    picks.push(item.tag)
  }
  return picks
}
