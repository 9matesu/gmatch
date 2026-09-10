/**
 * Sidebar navigation ordering (plan §2). Pure + storage-agnostic so it is
 * unit-testable without a DOM. Global localStorage key, matching the existing
 * `goonmatch_sidebar_collapsed` / `goonmatch_sidebar_groups` convention.
 */

export const SIDEBAR_ORDER_KEY = 'goonmatch_sidebar_order_v2';

/** Canonical top-level order; also the fallback for unknown/new ids. */
export const DEFAULT_SIDEBAR_ORDER: readonly string[] = [
  'feed',
  'games',
  'rooms',
  'messages',
  'notifications',
  'servers',
  'pc_domination',
  'settings',
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function currentStorage(): StorageLike | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

export function readSidebarOrder(storage: StorageLike | undefined = currentStorage()): string[] {
  try {
    const raw = storage?.getItem(SIDEBAR_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_ORDER];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
  } catch {
    /* fall through to default */
  }
  return [...DEFAULT_SIDEBAR_ORDER];
}

export function writeSidebarOrder(order: string[], storage: StorageLike | undefined = currentStorage()): void {
  try {
    storage?.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/**
 * Move `draggedId` so it lands just before `targetId`. No-op when either id is
 * absent or they are equal, so an unrecognised drop never reorders the list.
 */
export function reorderSidebarIds(
  order: string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId) return [...order];
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return [...order];
  const next = [...order];
  next.splice(from, 1);
  const insertAt = next.indexOf(targetId);
  next.splice(insertAt, 0, draggedId);
  return next;
}

/**
 * Reconcile a saved order against the ids currently visible in the sidebar.
 * - Keeps every saved id that is visible, in saved order.
 * - Ids missing from the save (new / conditional entries that just appeared)
 *   slot into their default position; ids unknown to the default sort last by
 *   their own stable order.
 * - Never invents ids: only `visibleIds` come back, each exactly once.
 */
export function reconcileSidebarOrder(savedOrder: string[], visibleIds: string[]): string[] {
  const rank = new Map<string, number>();
  savedOrder.forEach((id, i) => rank.set(id, i));
  const defRank = new Map<string, number>();
  DEFAULT_SIDEBAR_ORDER.forEach((id, i) => defRank.set(id, i));

  const rankOf = (id: string) => (rank.has(id) ? rank.get(id)! : Number.MAX_SAFE_INTEGER);
  const defOf = (id: string) => (defRank.has(id) ? defRank.get(id)! : DEFAULT_SIDEBAR_ORDER.length);

  // Array.prototype.sort is stable (ES2019+), so equal keys keep input order.
  return [...visibleIds].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    return defOf(a) - defOf(b);
  });
}
