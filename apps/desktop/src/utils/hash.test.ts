import { describe, it, expect } from 'vitest';
import { hashSeed } from './hash';

describe('hashSeed', () => {
  it('is deterministic across calls', () => {
    expect(hashSeed('goonmatch')).toBe(hashSeed('goonmatch'));
  });

  it('returns a non-negative integer', () => {
    for (const s of ['', 'a', 'hello world', '🔞', 'x'.repeat(500)]) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it('distinguishes different inputs', () => {
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed('abc')).not.toBe(hashSeed('ABC'));
  });

  it('matches the known reference values (moved verbatim from App.tsx)', () => {
    // h = (h * 31 + charCode) | 0, then Math.abs
    let h = 0;
    for (let i = 0; i < 'seed'.length; i++) h = (h * 31 + 'seed'.charCodeAt(i)) | 0;
    expect(hashSeed('seed')).toBe(Math.abs(h));
    expect(hashSeed('')).toBe(0);
  });

  it('stays within 32-bit signed range after abs', () => {
    const h = hashSeed('long-ish input string for overflow: 0123456789'.repeat(10));
    expect(h).toBeLessThanOrEqual(2 ** 31);
  });
});
