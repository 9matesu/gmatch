export type FeedSort = 'latest' | 'trending';

export const DEFAULT_FEED_SORT: FeedSort = 'trending';

export const FEED_SORT_LABELS: Record<FeedSort, string> = {
  trending: 'For You',
  latest: 'Latest',
};

export function isFeedSort(v: unknown): v is FeedSort {
  return v === 'latest' || v === 'trending';
}

/** Session flash rule: my post crossing 0 -> 1 likes is worth a celebration. */
export function firstLikeCrossed(prev: number, next: number): boolean {
  return prev === 0 && next > 0;
}
