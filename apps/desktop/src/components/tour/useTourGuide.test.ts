// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTourGuide } from './useTourGuide';
import { TOUR_STEPS, readTourState } from '../../firstRun/tourState';

function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  } as Storage);
}

function setup(identityId: string | null = 'u-1') {
  const navigateToView = vi.fn();
  const setGamesTab = vi.fn();
  const utils = renderHook(() =>
    useTourGuide({ identityId, navigateToView, setGamesTab }),
  );
  return { ...utils, navigateToView, setGamesTab };
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTourGuide', () => {
  it('starts at the stored (or fresh) tour state', () => {
    const { result } = setup();
    expect(result.current.tourState).toEqual({ version: 1, index: 0, status: 'active' });
    expect(result.current.steps).toBe(TOUR_STEPS);
  });

  it('advance(1) teleports to the step view + games tab, then steps forward', () => {
    const { result, navigateToView, setGamesTab } = setup();
    // index 0 = feed (no gamesTab)
    act(() => { result.current.advance(1); });
    expect(navigateToView).toHaveBeenCalledWith('feed');
    expect(setGamesTab).not.toHaveBeenCalled();
    expect(result.current.tourState.index).toBe(1);
    // index 1 = grid
    act(() => { result.current.advance(1); });
    expect(navigateToView).toHaveBeenCalledWith('grid');
    expect(result.current.tourState.index).toBe(2);
  });

  it('advance(1) on the idle step lands on games/idle', () => {
    const { result, navigateToView, setGamesTab } = setup();
    act(() => { result.current.goToStepId('idle'); });
    expect(navigateToView).toHaveBeenCalledWith('games');
    expect(setGamesTab).toHaveBeenCalledWith('idle');
    expect(result.current.tourState.index).toBe(TOUR_STEPS.findIndex((s) => s.id === 'idle'));
  });

  it('goToStepId jumps the deck card straight to its section', () => {
    const { result, navigateToView, setGamesTab } = setup();
    act(() => { result.current.goToStepId('duel'); });
    expect(navigateToView).toHaveBeenCalledWith('games');
    expect(setGamesTab).toHaveBeenCalledWith('duel');
    expect(result.current.tourState.index).toBe(TOUR_STEPS.findIndex((s) => s.id === 'duel'));
    // unknown ids are ignored
    act(() => { result.current.goToStepId('nope'); });
    expect(result.current.tourState.index).toBe(TOUR_STEPS.findIndex((s) => s.id === 'duel'));
  });

  it('advance(-1) teleports back to the previous step view', () => {
    const { result, navigateToView } = setup();
    act(() => { result.current.goToStepId('duel'); });
    navigateToView.mockClear();
    act(() => { result.current.advance(-1); });
    // step before duel is idle -> games view
    expect(navigateToView).toHaveBeenCalledWith('games');
    expect(result.current.tourState.index).toBe(TOUR_STEPS.findIndex((s) => s.id === 'duel') - 1);
    // back at 0 stays put
    act(() => { result.current.goToStepId('feed'); });
    navigateToView.mockClear();
    act(() => { result.current.advance(-1); });
    expect(navigateToView).not.toHaveBeenCalled();
    expect(result.current.tourState.index).toBe(0);
  });

  it('null-view steps (settings) teleport nowhere but still advance', () => {
    const { result, navigateToView } = setup();
    act(() => { result.current.goToStepId('settings'); });
    expect(navigateToView).not.toHaveBeenCalled();
    expect(result.current.tourState.index).toBe(TOUR_STEPS.length - 1);
    act(() => { result.current.advance(1); });
    expect(result.current.tourState.status).toBe('done');
  });

  it('skip marks the tour skipped and persists per identity', () => {
    const { result } = setup('u-9');
    act(() => { result.current.skip(); });
    expect(result.current.tourState.status).toBe('skipped');
    expect(readTourState('u-9').status).toBe('skipped');
  });
});
