import { describe, it, expect } from 'vitest';
import { tierForMatches, tierColor, tierLabel, parseTags } from './index';

describe('Tier system math and helpers', () => {
  it('computes triangular tier boundaries correctly', () => {
    expect(tierForMatches(0)).toBe(0);
    expect(tierForMatches(1)).toBe(1);
    expect(tierForMatches(2)).toBe(1);
    expect(tierForMatches(3)).toBe(2);
    expect(tierForMatches(4)).toBe(2);
    expect(tierForMatches(5)).toBe(2);
    expect(tierForMatches(6)).toBe(3);
    expect(tierForMatches(10)).toBe(4);
    expect(tierForMatches(15)).toBe(5);
    expect(tierForMatches(21)).toBe(6);
  });

  it('generates tier colors from Blue (#3b82f6) to Red (#ef4444)', () => {
    expect(tierColor(0)).toBe('#3b82f6');
    expect(tierColor(3)).toBe('#10b981');
    expect(tierColor(6)).toBe('#f97316');
    expect(tierColor(12)).toBe('#ef4444');
  });

  it('provides tier labels correctly', () => {
    expect(tierLabel(0)).toBe('Unranked');
    expect(tierLabel(1)).toBe('Acquaintance');
    expect(tierLabel(3)).toBe('Regular');
    expect(tierLabel(10)).toBe('Mythic');
    expect(tierLabel(11)).toBe('Divine Tier 11');
  });

  it('safely parses tags from arrays, json strings, comma strings, and unexpected types', () => {
    expect(parseTags(['art', 'music'])).toEqual(['art', 'music']);
    expect(parseTags('["retro", "chill"]')).toEqual(['retro', 'chill']);
    expect(parseTags('gaming, photography')).toEqual(['gaming', 'photography']);
    expect(parseTags('single-tag')).toEqual(['single-tag']);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(123)).toEqual([]);
    expect(parseTags({})).toEqual([]);
  });
});
