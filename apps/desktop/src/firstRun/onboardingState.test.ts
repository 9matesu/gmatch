import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeStep,
  initialOnboardingState,
  isOnboardingComplete,
  nextIncompleteStep,
  onboardingStorageKey,
  readOnboardingState,
  writeOnboardingState,
  type OnboardingState,
} from './onboardingState';

const storage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = value; },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key]; },
  key: () => null,
  length: 0,
} as Storage;
globalThis.window = { localStorage: globalThis.localStorage } as unknown as Window & typeof globalThis;

describe('onboarding state', () => {
  beforeEach(() => localStorage.clear());

  it('advances deterministically through the required steps', () => {
    let state = initialOnboardingState();
    expect(nextIncompleteStep(state)).toBe('welcome');
    state = completeStep(state, 'welcome');
    expect(state.current).toBe('auth');
    state = completeStep(state, 'auth');
    expect(state.current).toBe('profile');
  });

  it('persists progress per identity and resumes it', () => {
    const state = completeStep(initialOnboardingState(), 'welcome');
    writeOnboardingState('orbit-a', state);
    writeOnboardingState('orbit-b', initialOnboardingState());

    expect(readOnboardingState('orbit-a')).toEqual(state);
    expect(readOnboardingState('orbit-b').current).toBe('welcome');
    expect(localStorage.getItem(onboardingStorageKey('orbit-a'))).toContain('auth');
  });

  it('marks the guide complete only after the ready step', () => {
    const almostReady: OnboardingState = { ...initialOnboardingState(), current: 'ready', completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games'] };
    const complete = completeStep(almostReady, 'ready');
    expect(complete.completed).toContain('ready');
    expect(nextIncompleteStep(complete)).toBeNull();
    expect(isOnboardingComplete(complete)).toBe(true);
    expect(isOnboardingComplete(almostReady)).toBe(false);
  });

  it('keeps completion persisted for the same identity', () => {
    const complete = completeStep({
      ...initialOnboardingState(),
      completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games'],
      current: 'ready',
    }, 'ready');

    writeOnboardingState('orbit-a', complete);

    expect(isOnboardingComplete(readOnboardingState('orbit-a'))).toBe(true);
    expect(isOnboardingComplete(readOnboardingState('orbit-b'))).toBe(false);
  });
});
