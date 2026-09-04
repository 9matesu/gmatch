"use client";

import { useEffect, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { saveUserProfile, profileIsComplete } from '../utils/profile';
import { ProfileSetupForm } from '../components/profile/ProfileSetupForm';
import { GoonMatchLoginPage } from '../components/auth/GoonMatchLoginPage';
import {
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStep,
  completeStep,
  isOnboardingComplete,
  onboardingStorageKey,
  readOnboardingState,
  writeOnboardingState,
} from './onboardingState';
import { isDefaultPeerName } from '@orbit/shared';

type Profile = { displayName: string; tags: string[]; pfpUrl?: string };

interface Props {
  identity: OrbitIdentity | null;
  initialProfile: Profile;
  onLogin: (name: string, tags?: string, customKey?: string, pfpUrl?: string) => Promise<void>;
  onCreateAccount: (name: string, tags?: string, pfpUrl?: string) => Promise<void>;
  onProfileUpdated: (profile: Profile) => void;
  onComplete: () => void;
  onOpenTos: () => void;
  /** Tag suggestions fed from the user's own in-game (post) tags. */
  tagSuggestions?: string[];
}

const STEP_COPY: Record<OnboardingStep, { title: string; description: string }> = {
  welcome: { title: 'Share. Play. Goon. Edge.', description: 'goonMatch is our ~pornify~ everything microniche fetish. A social media for porn addicts, but as a game.' },
  auth: { title: 'Assign a identity', description: 'Your identity keeps your profile, cards, and progress together.' },
  profile: { title: 'Make your profile yours', description: 'Choose a name and a few tags so the feed feels relevant.' },
  platform: { title: 'How goonMatch works', description: 'The feed is social, cards capture recognition, and games put your collection to work.' },
  feed: { title: 'The feed is your starting point', description: 'Share porn, discover other perverts, and react to posts you enjoy.' },
  cards: { title: 'Likes build recognition', description: 'Likes show appreciation. Cards carry content into the game system. They are not the same as g$.' },
  economy: { title: 'g$ powers the game', description: 'Use g$ for supported cards, trades, and power-ups.' },
  games: { title: 'Bring your cards to games', description: 'Build a deck, enter a round, react to cards, and enjoy trading cards, you bastard!.' },
  ready: { title: "You're ready", description: 'Your account is set up and your first game is waiting. Remember to keep it chill.' },
};

export function OnboardingFlow({
  identity,
  initialProfile,
  onLogin,
  onCreateAccount,
  onProfileUpdated,
  onComplete,
  onOpenTos,
  tagSuggestions = [],
}: Props) {
  const identityId = identity?.orbitId || null;
  const [state, setState] = useState<OnboardingState>(() => {
    return readOnboardingState(identityId);
  });
  const [stateKey, setStateKey] = useState(onboardingStorageKey(identityId));
  const [name, setName] = useState(initialProfile.displayName);
  const [tags, setTags] = useState<string[]>(initialProfile.tags);
  const [pfpUrl, setPfpUrl] = useState(initialProfile.pfpUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!identity) return;
    const nextKey = onboardingStorageKey(identityId);
    const nextState = readOnboardingState(identityId);
    const anonymous = readOnboardingState(null);
    let migrated = nextState;

    // Migrate anonymous progress when identity-scoped state is empty
    if (nextState.completed.length === 0 && anonymous.completed.includes('welcome')) {
      migrated = {
        ...nextState,
        completed: Array.from(new Set([...anonymous.completed, 'auth'])) as OnboardingStep[],
        current: 'profile',
      };
    }
    // Returning authenticated user with no onboarding history -> treat as complete only if not default peer name
    else if (nextState.completed.length === 0 && anonymous.completed.length === 0) {
      if (isDefaultPeerName(initialProfile.displayName)) {
        migrated = {
          ...nextState,
          completed: ['welcome', 'auth'],
          current: 'profile',
        };
      } else {
        migrated = {
          ...nextState,
          completed: [...ONBOARDING_STEPS] as OnboardingStep[],
          current: 'ready',
        };
      }
    } else if (isDefaultPeerName(initialProfile.displayName) && isOnboardingComplete(nextState)) {
      migrated = {
        ...nextState,
        completed: nextState.completed.filter((s) => s !== 'profile' && s !== 'ready'),
        current: 'profile',
      };
    }

    if (migrated !== nextState) {
      writeOnboardingState(identityId, migrated);
      setState(migrated);
    }
    setStateKey(nextKey);
  }, [identity, identityId]);

  useEffect(() => {
    setName(initialProfile.displayName);
    setTags(initialProfile.tags);
    setPfpUrl(initialProfile.pfpUrl || '');
  }, [initialProfile.displayName, initialProfile.tags, initialProfile.pfpUrl]);

  useEffect(() => {
    writeOnboardingState(identityId, state);
  }, [identityId, state]);

  const step = state.current;
  const stepIndex = ONBOARDING_STEPS.indexOf(step);
  const copy = STEP_COPY[step];
  const canBack = stepIndex > 0 && step !== 'auth' && step !== 'profile' && !busy;

  const advance = (stepToComplete: OnboardingStep = step) => {
    const next = completeStep(state, stepToComplete);
    setState(next);
    if (next.current === 'ready' && next.completed.includes('ready')) {
      writeOnboardingState(identityId, next);
      onComplete();
    }
  };

  const back = () => {
    if (!canBack) return;
    const previous = ONBOARDING_STEPS[Math.max(0, stepIndex - 1)];
    setState((current) => ({ ...current, current: previous }));
  };

  const saveProfile = async () => {
    if (!identity || !profileIsComplete(name, tags, pfpUrl)) return;
    setBusy(true);
    setError('');
    try {
      const res = await saveUserProfile(identity, {
        display_name: name.trim(),
        tags,
        pfp_url: pfpUrl.trim() || undefined,
      });
      if (!res.ok) throw new Error('Profile could not be saved');
      const nextProfile = { displayName: name.trim(), tags, pfpUrl: pfpUrl.trim() || undefined };
      onProfileUpdated(nextProfile);
      advance('profile');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profile could not be saved');
    } finally {
      setBusy(false);
    }
  };

  if (isOnboardingComplete(state)) return null;

  return (
    <div className="fixed inset-0 z-[99990] overflow-y-auto bg-[#080A0D] text-retro-fg font-sans">
      <div className="min-h-[100dvh] max-w-6xl mx-auto px-4 py-6 sm:py-10 flex flex-col justify-center">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-retro-accent" /> goonMatch setup
          </div>
          <span className="text-xs text-retro-muted">Step {Math.min(stepIndex + 1, ONBOARDING_STEPS.length)} of {ONBOARDING_STEPS.length}</span>
        </div>

        <div className="h-1 bg-white/10 rounded-full mb-6 overflow-hidden">
          <div className="h-full bg-retro-accent transition-all" style={{ width: `${((stepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>

        {step === 'auth' && !identity ? (
          <GoonMatchLoginPage onLogin={onLogin} onCreateAccount={onCreateAccount} onOpenTos={onOpenTos} tagSuggestions={tagSuggestions} />
        ) : step === 'auth' && identity ? (
          null
        ) : (
          <section className="glass-panel p-6 sm:p-10 max-w-2xl w-full mx-auto space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-retro-accent">{step === 'ready' ? 'Complete' : 'Getting started'}</p>
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight">{copy.title}</h1>
              <p className="text-sm text-retro-muted leading-relaxed">{copy.description}</p>
            </div>

            {error && <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

            {step === 'welcome' && (
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                {['Share what you like', 'Collect recognition', 'Play with your cards'].map((item) => <div key={item} className="rounded-md border border-border-glass bg-white/5 p-4 font-semibold">{item}</div>)}
              </div>
            )}

            {step === 'profile' && (
              <div className="w-full max-w-md mx-auto">
                <ProfileSetupForm
                  name={name}
                  onName={setName}
                  tags={tags}
                  onTags={setTags}
                  pfpUrl={pfpUrl}
                  onPfp={setPfpUrl}
                  suggestions={tagSuggestions}
                />
              </div>
            )}

            {step === 'platform' && <div className="space-y-3 text-sm text-retro-muted"><p><strong className="text-retro-fg">Feed:</strong> your social space for sharing and discovering.</p><p><strong className="text-retro-fg">Cards:</strong> community content that can become part of your collection.</p><p><strong className="text-retro-fg">Games:</strong> use an eligible deck to play rounds and earn recognition.</p></div>}
            {step === 'feed' && <div className="rounded-md border border-border-glass bg-white/5 p-5 text-sm text-retro-muted">After setup, the Feed tab is where you will share images, browse Latest and Trending, and respond to the community.</div>}
            {step === 'cards' && <div className="rounded-md border border-border-glass bg-white/5 p-5 text-sm text-retro-muted">Likes are appreciation. Cards are playable content. A like can help recognition, but it is never a replacement for g$.</div>}
            {step === 'economy' && <div className="rounded-md border border-border-glass bg-white/5 p-5 text-sm text-retro-muted">g$ can support card purchases, trades, and game power-ups. Your balance and transactions stay inside the product.</div>}
            {step === 'games' && <div className="rounded-md border border-border-glass bg-white/5 p-5 text-sm text-retro-muted">Games are played with decks. Reactions affect rounds, and rankings show cards and players getting noticed.</div>}
            {step === 'ready' && <div className="rounded-md border border-retro-accent/40 bg-retro-accent/10 p-5 flex gap-3 text-sm"><Check className="w-5 h-5 text-retro-accent shrink-0" /> Your account is set up and your first game is waiting.</div>}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button type="button" onClick={back} disabled={!canBack} className="px-4 py-2 rounded-md border border-border-glass text-sm font-semibold disabled:opacity-30"><ArrowLeft className="w-4 h-4 inline mr-2" />Back</button>
              <button type="button" onClick={() => step === 'profile' ? saveProfile() : advance()} disabled={busy || (step === 'profile' && !profileIsComplete(name, tags, pfpUrl))} className="px-5 py-2 rounded-md chrome-accent text-sm font-black text-black disabled:opacity-40">{busy ? 'Saving...' : step === 'ready' ? 'Enter goonMatch' : 'Continue'} <ArrowRight className="w-4 h-4 inline ml-2" /></button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
