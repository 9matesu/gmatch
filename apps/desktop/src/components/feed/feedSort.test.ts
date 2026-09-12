import { describe, expect, it } from 'vitest';
import { DEFAULT_FEED_SORT, FEED_SORT_LABELS, firstLikeCrossed, isFeedSort } from './feedSort';

describe('feedSort contract', () => {
  it('starts on For You', () => {
    expect(DEFAULT_FEED_SORT).toBe('trending');
  });
  it('labels trending as For You, latest stays Latest', () => {
    expect(FEED_SORT_LABELS.trending).toBe('For You');
    expect(FEED_SORT_LABELS.latest).toBe('Latest');
  });
  it('firstLikeCrossed fires only on the 0 -> positive edge', () => {
    expect(firstLikeCrossed(0, 1)).toBe(true);
    expect(firstLikeCrossed(0, 0)).toBe(false);
    expect(firstLikeCrossed(1, 2)).toBe(false);
    expect(firstLikeCrossed(2, 1)).toBe(false);
  });
  it('isFeedSort guards persisted junk', () => {
    expect(isFeedSort('latest')).toBe(true);
    expect(isFeedSort('for-you')).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});
