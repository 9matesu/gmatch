export type FeedSort = 'latest' | 'trending';

export const DEFAULT_FEED_SORT: FeedSort = 'trending';

export const FEED_SORT_LABELS: Record<FeedSort, string> = {
  trending: 'For You',
  latest: 'Latest',
};

export function isFeedSort(v: unknown): v is FeedSort {
  return v === 'latest' || v === 'trending';
}
