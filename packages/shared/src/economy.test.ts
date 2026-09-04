import { describe, it, expect } from 'vitest';
import {
  computeCashoutPayout,
  clampCashoutRateBps,
  formatGc,
  DEFAULT_CASHOUT_RATE_BPS,
  MIN_CASHOUT_RATE_BPS,
  MAX_CASHOUT_RATE_BPS,
} from './index';

describe('cashout economy helpers', () => {
  it('computes payout in basis points (10000 = 100%)', () => {
    expect(computeCashoutPayout(1000, 10000)).toBe(1000);
    expect(computeCashoutPayout(1000, 12500)).toBe(1250);
    expect(computeCashoutPayout(1000, 20000)).toBe(2000);
  });

  it('floors fractional payouts and handles zero/negative values', () => {
    expect(computeCashoutPayout(999, 12500)).toBe(1248); // 999 * 1.25 = 1248.75 -> 1248
    expect(computeCashoutPayout(0, 12500)).toBe(0);
    expect(computeCashoutPayout(-5, 12500)).toBe(0);
  });

  it('clamps rates into legal bounds with a sensible default', () => {
    expect(clampCashoutRateBps(null)).toBe(DEFAULT_CASHOUT_RATE_BPS);
    expect(clampCashoutRateBps(999999)).toBe(MAX_CASHOUT_RATE_BPS);
    expect(clampCashoutRateBps(1)).toBe(MIN_CASHOUT_RATE_BPS);
    expect(clampCashoutRateBps(15000)).toBe(15000);
  });

  it('formats g$ with thousands separators', () => {
    expect(formatGc(0)).toBe('g$ 0');
    expect(formatGc(1250)).toBe('g$ 1,250');
    expect(formatGc(1234567)).toBe('g$ 1,234,567');
    expect(formatGc(null)).toBe('g$ 0');
  });
});
