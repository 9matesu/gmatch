import { describe, it, expect } from 'vitest';
import { parseSeenMs, isUserOnline, fresherPresence } from './presence';

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

describe('fresherPresence', () => {
  const now = 1758380000000;
  // The server maps a missing sighting to undefined (`last_seen || undefined`),
  // so `null` never appears on a User — but the helper is written loosely
  // enough to accept either, and the tests should say which they mean.
  type Rec = { id: string; last_seen?: string | null; online?: boolean };
  const at = (ms: number): Rec => ({ id: 'a', last_seen: new Date(ms).toISOString() });

  // The split-brain bug: the modal took `roster ?? subject`, so a stale roster
  // entry always beat fresher data the caller had just fetched from a different
  // live source. Compare sightings instead of precedence.
  it('prefers the record with the newer sighting', () => {
    const stale = { id: 'a', last_seen: new Date(now - 300_000).toISOString(), online: true };
    const fresh = { id: 'a', last_seen: new Date(now - 5_000).toISOString(), online: true };
    expect(fresherPresence(stale, fresh)).toBe(fresh);
    expect(fresherPresence(fresh, stale)).toBe(fresh);
  });

  it('keeps the subject when the roster has nothing to say', () => {
    const subject = at(now - 5_000);
    // Presence-less AND flag-less: no information, so the subject stands.
    expect(fresherPresence(subject, { id: 'a' })).toBe(subject);
    // A bare `online` flag on the roster is weaker than a real sighting on the
    // subject: a flag has no time on it, so it can be arbitrarily old.
    expect(fresherPresence(subject, { id: 'a', online: true })).toBe(subject);
  });

  it('uses the roster flag only when the subject has no sighting either', () => {
    // Both presence-less; the roster is the only one claiming presence, and
    // that claim is what the caller would otherwise silently lose to offline.
    const subject: Rec = { id: 'a' };
    expect(fresherPresence(subject, { id: 'a', online: true })).toEqual({ id: 'a', online: true });
  });

  it('prefers a real sighting over a presence-less record', () => {
    // The arena builds its object with only an `online` flag for anyone outside
    // the 100-row directory; a real sighting must outrank it.
    const subject: Rec = { id: 'a', last_seen: null, online: true };
    const roster = at(now - 5_000);
    expect(fresherPresence(subject, roster)).toBe(roster);
  });

  it('does not resurrect an empty roster slot over real data', () => {
    const subject = at(now - 5_000);
    expect(fresherPresence(subject, undefined)).toBe(subject);
    expect(fresherPresence(undefined, subject)).toBe(subject);
  });
});
