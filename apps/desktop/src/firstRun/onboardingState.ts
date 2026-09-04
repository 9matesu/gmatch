export const ONBOARDING_STEPS = [
  'welcome',
  'auth',
  'profile',
  'platform',
  'feed',
  'cards',
  'economy',
  'games',
  'ready',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  version: 1;
  current: OnboardingStep;
  completed: OnboardingStep[];
}

const STORAGE_PREFIX = 'orbit_onboarding_v2:';

export function onboardingStorageKey(identityId?: string | null) {
  return `${STORAGE_PREFIX}${identityId || 'anonymous'}`;
}

export function initialOnboardingState(): OnboardingState {
  return { version: 1, current: 'welcome', completed: [] };
}

export function readOnboardingState(identityId?: string | null): OnboardingState {
  if (typeof window === 'undefined') return initialOnboardingState();
  try {
    const raw = localStorage.getItem(onboardingStorageKey(identityId));
    if (!raw) return initialOnboardingState();
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    const completed = Array.isArray(parsed.completed)
      ? parsed.completed.filter((step): step is OnboardingStep => ONBOARDING_STEPS.includes(step as OnboardingStep))
      : [];
    const current = ONBOARDING_STEPS.includes(parsed.current as OnboardingStep)
      ? (parsed.current as OnboardingStep)
      : 'welcome';
    return { version: 1, current, completed: Array.from(new Set(completed)) };
  } catch {
    return initialOnboardingState();
  }
}

export function writeOnboardingState(identityId: string | null | undefined, state: OnboardingState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(onboardingStorageKey(identityId), JSON.stringify(state));
  } catch {
    // The in-memory state remains usable when browser storage is unavailable.
  }
}

export function nextIncompleteStep(state: OnboardingState): OnboardingStep | null {
  return ONBOARDING_STEPS.find((step) => !state.completed.includes(step)) || null;
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.completed.includes('ready');
}

export function completeStep(state: OnboardingState, step: OnboardingStep): OnboardingState {
  const completed = Array.from(new Set([...state.completed, step]));
  const next = ONBOARDING_STEPS.find((candidate) => !completed.includes(candidate));
  return { version: 1, completed, current: next || 'ready' };
}
