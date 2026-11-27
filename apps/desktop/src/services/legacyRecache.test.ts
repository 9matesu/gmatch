import { describe, it, expect, vi } from 'vitest';
import { recacheLegacyMedia, isLegacyUncached, type RecacheDeps } from './legacyRecache';
import type { GalleryImage } from '../game/types';

const keep = (over: Partial<GalleryImage>): GalleryImage => ({
  id: 'g1',
  url: 'https://media.redgifs.com/x.mp4',
  tags: [],
  rarityBase: 1,
  clicks: 0,
  rarity: 'Common',
  ...over,
});

const deps = (over: Partial<RecacheDeps>): RecacheDeps => ({
  listKeepsakes: () => [],
  persist: async () => ({ status: 'local', ref: 'a'.repeat(64), bytes: 10 }),
  update: () => {},
  ...over,
});

describe('isLegacyUncached', () => {
  it('flags a provider url with no verified local bytes', () => {
    expect(isLegacyUncached(keep({}))).toBe(true);
    expect(isLegacyUncached(keep({ saveState: 'failed' }))).toBe(true);
  });
  it('skips an already-persisted keep and a non-http url', () => {
    expect(isLegacyUncached(keep({ saveState: 'persisted', localRef: 'a'.repeat(64) }))).toBe(false);
    expect(isLegacyUncached(keep({ url: 'vault://f/' + 'a'.repeat(64) }))).toBe(false);
    expect(isLegacyUncached(keep({ url: '' }))).toBe(false);
  });
});

describe('recacheLegacyMedia', () => {
  it('fetches each legacy keep, stamps it persisted, and counts', async () => {
    const update = vi.fn();
    const summary = await recacheLegacyMedia({
      deps: deps({
        listKeepsakes: () => [keep({ id: 'a' }), keep({ id: 'b', saveState: 'failed' })],
        update,
      }),
    });
    expect(summary).toEqual({ scanned: 2, cached: 2, failed: 0 });
    expect(update).toHaveBeenCalledWith('a', { saveState: 'persisted', localRef: 'a'.repeat(64) });
  });

  it('leaves a keep untouched when the fetch fails', async () => {
    const update = vi.fn();
    const summary = await recacheLegacyMedia({
      deps: deps({
        listKeepsakes: () => [keep({ id: 'a' })],
        persist: async () => ({ status: 'failed', reason: 'fetch' }),
        update,
      }),
    });
    expect(summary).toEqual({ scanned: 1, cached: 0, failed: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not touch already-persisted keeps', async () => {
    const persist = vi.fn(async () => ({ status: 'local' as const, ref: 'a'.repeat(64) }));
    const summary = await recacheLegacyMedia({
      deps: deps({
        listKeepsakes: () => [keep({ id: 'a', saveState: 'persisted', localRef: 'a'.repeat(64) })],
        persist,
      }),
    });
    expect(summary).toEqual({ scanned: 0, cached: 0, failed: 0 });
    expect(persist).not.toHaveBeenCalled();
  });
});