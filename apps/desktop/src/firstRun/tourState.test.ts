// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TOUR_KEY_PREFIX,
  TOUR_STEPS,
  initialTourState,
  isTourOver,
  nextTourStep,
  readTourState,
  wipeAllTourStates,
  writeTourState,
} from './tourState';

function stubLocalStorage() {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
  // Proxy so Object.keys(localStorage) enumerates stored keys (opaque-origin quirk).
  const proxy = new Proxy(store, {
    ownKeys: () => Array.from(data.keys()),
    getOwnPropertyDescriptor: (_t, prop) =>
      typeof prop === 'string' && data.has(prop)
        ? { configurable: true, enumerable: true, value: data.get(prop) }
        : undefined,
  }) as unknown as Storage;
  vi.stubGlobal('localStorage', proxy);
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('tourState', () => {
  it('defaults to step 0, not dismissed', () => {
    stubLocalStorage();
    expect(initialTourState()).toEqual({ version: 1, index: 0, status: 'active' });
  });

  it('reads/writes per identity key and survives garbage', () => {
    const data = stubLocalStorage();
    writeTourState('abc', { version: 1, index: 3, status: 'active' });
    expect(JSON.parse(data.get(`${TOUR_KEY_PREFIX}abc`)!)).toMatchObject({ index: 3 });
    data.set(`${TOUR_KEY_PREFIX}abc`, '{{{');
    expect(readTourState('abc').index).toBe(0);
  });

  it('clamps stored index and respects done/skipped status on read', () => {
    const data = stubLocalStorage();
    data.set(`${TOUR_KEY_PREFIX}abc`, JSON.stringify({ version: 1, index: 9999, status: 'skipped' }));
    const s = readTourState('abc');
    expect(s.index).toBe(TOUR_STEPS.length - 1);
    expect(s.status).toBe('skipped');
  });

  it('nextTourStep advances and completes at the end', () => {
    stubLocalStorage();
    let s = initialTourState();
    s = nextTourStep(s);
    expect(s.index).toBe(1);
    s = { version: 1, index: TOUR_STEPS.length - 1, status: 'active' };
    expect(nextTourStep(s).status).toBe('done');
  });

  it('isTourOver hides the dock for done and skipped', () => {
    expect(isTourOver({ version: 1, index: 0, status: 'active' })).toBe(false);
    expect(isTourOver({ version: 1, index: 9, status: 'done' })).toBe(true);
    expect(isTourOver({ version: 1, index: 2, status: 'skipped' })).toBe(true);
  });

  it('wipeAllTourStates removes only tour keys', () => {
    const data = stubLocalStorage();
    data.set(`${TOUR_KEY_PREFIX}one`, '{}');
    data.set(`${TOUR_KEY_PREFIX}two`, '{}');
    data.set('something_else', 'keep');
    wipeAllTourStates();
    expect(data.has(`${TOUR_KEY_PREFIX}one`)).toBe(false);
    expect(data.has(`${TOUR_KEY_PREFIX}two`)).toBe(false);
    expect(data.get('something_else')).toBe('keep');
    // after a wipe, reads return fresh step 0 (that IS the re-arm path)
    expect(readTourState('one')).toEqual({ version: 1, index: 0, status: 'active' });
  });

  it('every step id is unique, copy is English, view is valid', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const views = new Set(['feed', 'grid', 'create', 'games', 'store', 'messages', 'gallery', 'servers', null]);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(2);
      expect(s.text.length).toBeGreaterThan(10);
      expect(views.has(s.view)).toBe(true);
      // humanizer contract: no emoji, no em dashes, ASCII copy
      expect(s.title + s.text).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});
