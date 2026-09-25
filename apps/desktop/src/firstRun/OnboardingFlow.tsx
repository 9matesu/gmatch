"use client";

// Social onboarding: the 18+ gate lives in AgeGateModal (rendered above this
// wall); this is server picker → profile only. Joining a server stamps
// SERVER_MARKER_KEY and relaunches; the post-restart mount resumes at profile.
import { useCallback, useEffect, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Dices,
  KeyRound,
} from 'lucide-react';
import { API_BASE } from '../utils/api';
import { ServersView } from '../components/servers/ServersView';
import {
  SERVER_MARKER_KEY,
  type OnboardingState,
  isOnboardingComplete,
  readOnboardingState,
  writeOnboardingState,
} from './onboardingState';
import { saveUserProfile } from '../utils/profile';
import { playPress, playWin } from '../utils/sounds';
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
  /** createIdentity() from useIdentity — local keypair only, no server call. */
  ensureIdentity: () => OrbitIdentity | null;
  tagSuggestions?: string[];
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function sameOrigin(a: string, b: string): boolean {
  return a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
}

export function OnboardingFlow(props: Props) {
  const { identity, initialProfile, toast } = props;
  const identityId = identity?.orbitId || null;
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState(identityId));
  const [step, setStep] = useState<'server' | 'profile'>(() => {
    try {
      const marker = localStorage.getItem(SERVER_MARKER_KEY);
      const chosenUrl = localStorage.getItem('gmatch.api.url');
      if (!marker) return 'server';
      if (!API_BASE || sameOrigin(marker, API_BASE) || (chosenUrl && sameOrigin(marker, chosenUrl))) {
        return 'profile';
      }
      return 'server';
    } catch {
      return 'server';
    }
  });

  // Returning-user migration (kept from the old wall): a real display name or
  // a completed anonymous run means login-onboarding is done.
  useEffect(() => {
    const nextState = readOnboardingState(identityId);
    const anonymous = readOnboardingState(null);
    let migrated = nextState;
    if (
      nextState.completed.length === 0 &&
      (anonymous.completed.includes('ready') || !isDefaultPeerName(initialProfile.displayName))
    ) {
      migrated = { version: 1, completed: ['server', 'profile', 'ready'], current: 'ready' };
    }
    if (migrated !== nextState) {
      writeOnboardingState(identityId, migrated);
      setState(migrated);
    }
  }, [identityId, initialProfile.displayName]);

  useEffect(() => {
    writeOnboardingState(identityId, state);
  }, [identityId, state]);

  if (isOnboardingComplete(state)) return null;

  const finish = () => {
    const next: OnboardingState = { version: 1, completed: ['server', 'profile', 'ready'], current: 'ready' };
    writeOnboardingState(identityId, next);
    setState(next);
    props.onComplete();
  };

  // Server step = native browser, full-bleed, no ID: join stamps the marker
  // and smoothly transitions to profile.
  if (step === 'server') {
    return (
      <div className="fixed inset-0 z-[var(--z-lightbox)] overflow-y-auto bg-retro-bg font-sans animate-orbit-fade-in text-retro-fg flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ServersView
            identity={null}
            toast={toast || (() => { /* toasts */ })}
            onServerJoined={() => setStep('profile')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg">
      <div className="w-full max-w-2xl bg-retro-bg border border-border-glass rounded-xl p-6 sm:p-8 shadow-2xl space-y-5 animate-orbit-slide-up">
        <ProfileStep
          {...props}
          onBack={() => {
            try {
              localStorage.removeItem(SERVER_MARKER_KEY);
            } catch { /* private mode */ }
            setStep('server');
          }}
          onDone={finish}
        />
      </div>
    </div>
  );
}

function generateRandomHandle(): string {
  const prefixes = ['Cyber', 'Shadow', 'Neon', 'Velvet', 'Midnight', 'Pulse', 'Hyper', 'Ghost', 'Silk', 'Echo', 'Vortex', 'Static'];
  const suffixes = ['Gooner', 'Voyeur', 'Phantom', 'Drifter', 'Rider', 'Specter', 'Seeker', 'Nomad', 'Gridder'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}${suffix}_${num}`;
}

function ProfileStep(props: Props & { onBack: () => void; onDone: () => void }) {
  const { identity, initialProfile, onLogin, onCreateAccount, onProfileUpdated, onBack, onDone } = props;
  const [name, setName] = useState(() => {
    if (initialProfile.displayName && !isDefaultPeerName(initialProfile.displayName)) {
      return initialProfile.displayName;
    }
    return generateRandomHandle();
  });
  const [isImporting, setIsImporting] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enter = useCallback(async () => {
    if (busy) return;
    const effectiveName = name.trim() || generateRandomHandle();
    setBusy(true);
    setError('');
    try {
      if (isImporting) {
        if (!secretKey.trim()) throw new Error('Please enter your exported secret key');
        await onLogin(effectiveName, initialProfile.tags.join(','), secretKey.trim(), initialProfile.pfpUrl);
      } else if (!identity) {
        await onCreateAccount(effectiveName, initialProfile.tags.join(','), initialProfile.pfpUrl);
      } else {
        await saveUserProfile(identity, { display_name: effectiveName });
        onProfileUpdated({ displayName: effectiveName, tags: initialProfile.tags, pfpUrl: initialProfile.pfpUrl });
      }
      playWin();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete setup');
    } finally {
      setBusy(false);
    }
  }, [busy, name, isImporting, secretKey, identity, initialProfile, onLogin, onCreateAccount, onProfileUpdated, onDone]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Set up your profile</h1>
          <p className="text-xs text-retro-muted">Only your name is required. Everything else you can add later.</p>
        </div>
        <button
          type="button"
          onClick={() => { playPress(620); onBack(); }}
          className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1 shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Change server
        </button>
      </div>

      {isImporting ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="onboarding-secret-key" className="text-xs font-medium text-retro-fg">Secret Key</label>
            <input
              id="onboarding-secret-key"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Paste your exported secret key"
              className="w-full bg-retro-panel border border-border-glass rounded-lg px-3 py-2 text-xs font-mono text-retro-fg placeholder:text-retro-muted outline-none focus:border-border-glass transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="onboarding-import-name" className="text-xs font-medium text-retro-fg">Display Name (Optional)</label>
            <input
              id="onboarding-import-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank to use existing name"
              maxLength={30}
              className="w-full bg-retro-panel border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-border-glass transition-colors"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="onboarding-display-name" className="text-xs font-medium text-retro-fg flex items-center justify-between">
            <span>Display Name</span>
            <span className="text-[10px] text-retro-muted font-normal">Required · public handle</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="onboarding-display-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AnonGooner"
              maxLength={30}
              className="flex-1 bg-retro-panel border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-border-glass transition-colors"
            />
            <button
              type="button"
              onClick={() => { playPress(500); setName(generateRandomHandle()); }}
              title="Generate random anonymous handle"
              className="p-2 bg-retro-panel hover:bg-glass-w12 border border-border-glass rounded-lg text-retro-muted hover:text-retro-fg transition-colors cursor-pointer shrink-0"
            >
              <Dices className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => { playPress(400); setIsImporting((v) => !v); }}
        className="text-xs text-retro-muted hover:text-retro-fg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
      >
        <KeyRound className="w-3.5 h-3.5" />
        <span>{isImporting ? 'Create new anonymous identity instead' : 'Returning user? Import secret key'}</span>
      </button>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
      )}

      <button
        type="button"
        onClick={() => void enter()}
        disabled={busy || (!isImporting && !name.trim()) || (isImporting && !secretKey.trim())}
        className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-retro-fg active:scale-[0.99] text-black font-semibold text-xs shadow-sm transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
      >
        {busy ? (
          <span>Joining…</span>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Enter</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}
