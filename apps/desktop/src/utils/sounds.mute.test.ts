// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAudioMuted, setAudioMuted, playPress } from './sounds';

describe('audio mute flag', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('setAudioMuted persists and isAudioMuted reads it back', () => {
    expect(isAudioMuted()).toBe(false);
    setAudioMuted(true);
    expect(isAudioMuted()).toBe(true);
    setAudioMuted(false);
    expect(isAudioMuted()).toBe(false);
  });

  it('playPress is a silent no-op while muted (no AudioContext touch)', () => {
    const spy = vi.fn();
    vi.stubGlobal('AudioContext', spy);
    setAudioMuted(true);
    playPress(800);
    expect(spy).not.toHaveBeenCalled();
  });
});
