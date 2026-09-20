import { describe, it, expect } from 'vitest';
import { parseSeenMs, isUserOnline } from './presence';

describe('presence utility (DRY & Timezone-Safe)', () => {
  const now = 1758380000000;

  it('normalizes SQLite space-separated UTC strings without trailing Z', () => {
    const sqliteStr = new Date(now - 2 * 3600_000).toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
    const parsed = parseSeenMs(sqliteStr);
    expect(parsed).toBe(now - 2 * 3600_000);
  });

  it('detects fresh sightings within 60 seconds as online', () => {
    const freshIso = new Date(now - 30_000).toISOString();
    expect(isUserOnline({ last_seen: freshIso }, now)).toBe(true);
  });

  it('detects stale sightings (> 60 seconds) as offline', () => {
    const staleIso = new Date(now - 90_000).toISOString();
    expect(isUserOnline({ last_seen: staleIso }, now)).toBe(false);
  });

  it('prevents future timestamps from timezone mismatch being treated as online', () => {
    const futureIso = new Date(now + 3 * 3600_000).toISOString();
    expect(isUserOnline({ last_seen: futureIso }, now)).toBe(false);
  });

  it('keeps a fresh sighting online even when flag lags (online: false)', () => {
    const freshIso = new Date(now - 10_000).toISOString();
    expect(isUserOnline({ last_seen: freshIso, online: false }, now)).toBe(true);
  });

  it('treats stale sighting with online: true as offline (stale flag decay)', () => {
    const staleIso = new Date(now - 120_000).toISOString();
    expect(isUserOnline({ last_seen: staleIso, online: true }, now)).toBe(false);
  });

  it('returns false for null or undefined last_seen with no online flag', () => {
    expect(isUserOnline({ last_seen: null }, now)).toBe(false);
    expect(isUserOnline(null, now)).toBe(false);
  });
});
