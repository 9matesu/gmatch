import { describe, it, expect } from 'vitest';
import { tierForMatches, tierColor, tierLabel } from './tiers';

describe('Web tiers re-export utils', () => {
  it('correctly re-exports tier math functions', () => {
    expect(tierForMatches(0)).toBe(0);
    expect(tierForMatches(1)).toBe(1);
    expect(tierForMatches(3)).toBe(2);
    expect(tierColor(0)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(tierLabel(1)).toBe('Acquaintance');
  });
});
