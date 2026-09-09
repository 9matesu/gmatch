/**
 * Hash routing for the shell's main views (plan: unified navigation):
 * #/feed, #/grid, #/duels, ... — direct URLs work, back/forward work,
 * refresh preserves the view. Single source of truth for view <-> route.
 */

export const ROUTE_VIEWS = [
  'feed',
  'games',
  'create',
  'messages',
  'profile',
  'game',
  'gallery',
  'hack_spy',
  'store',
  'pc_domination',
  'grid',
  'rooms',
  'admin',
] as const

export type RoutedView = (typeof ROUTE_VIEWS)[number]

/** Pretty aliases for the URL (internal ids stay canonical in code). */
const ALIAS: Record<string, RoutedView> = {
  home: 'feed',
  duels: 'games',
  idle: 'grid',
  cards: 'gallery',
  dm: 'messages',
}

export function isRoutedView(v: string): v is RoutedView {
  return (ROUTE_VIEWS as readonly string[]).includes(v)
}

/** Parse `location.hash` ('#/grid?x=1') into a view, or null. */
export function viewFromHash(hash: string): RoutedView | null {
  const raw = hash.replace(/^#\/?/, '').split(/[?#]/)[0].toLowerCase()
  if (!raw) return null
  const v = ALIAS[raw] ?? raw
  return isRoutedView(v) ? v : null
}

/** Canonical hash for a view. */
export function hashForView(view: RoutedView): string {
  return `#/${view}`
}
