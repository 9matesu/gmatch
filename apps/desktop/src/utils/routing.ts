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
  'store',
  'pc_domination',
  'grid',
  'rooms',
  'servers',
  // NOT a route: the admin suite is a PIN-gated MODAL opened from the HUD
  // (AdminApp, CommandIsland's Admin button). It was briefly a view and was
  // left registered here after that reverted, so '#/admin' resolved to a view
  // with no render branch — a blank stage, persisted into orbit_main_view and
  // therefore on every launch. Keep it out of ROUTE_VIEWS so viewFromHash
  // rejects the deep link and App's persisted-view guard falls back to
  // 'feed'.
  'watch',
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

/**
 * Initial view: direct URL wins, then the last-visited persisted view, then
 * the feed. Fresh boot (no hash, no saved view) lands on the timeline —
 * the app's home — never the server directory or the profile.
 */
export function resolveInitialView(hash: string, saved: string | null): RoutedView {
  const fromHash = viewFromHash(hash)
  if (fromHash) return fromHash === 'messages' ? 'rooms' : fromHash
  if (saved && isRoutedView(saved)) return saved === 'messages' ? 'rooms' : saved
  return 'feed'
}
