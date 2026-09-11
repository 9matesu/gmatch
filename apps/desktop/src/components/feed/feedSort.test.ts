import { describe, expect, it } from 'vitest';
import { DEFAULT_FEED_SORT, FEED_SORT_LABELS, isFeedSort } from './feedSort';

describe('feedSort contract', () => {
  it('starts on For You', () => {
    expect(DEFAULT_FEED_SORT).toBe('trending');
  });
  it('labels trending as For You, latest stays Latest', () => {
    expect(FEED_SORT_LABELS.trending).toBe('For You');
    expect(FEED_SORT_LABELS.latest).toBe('Latest');
  });
  it('isFeedSort guards persisted junk', () => {
    expect(isFeedSort('latest')).toBe(true);
    expect(isFeedSort('for-you')).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});
