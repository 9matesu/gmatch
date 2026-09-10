"use client";

import { useEffect, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import {
  ShieldAlert,
  Lock,
  Scale,
  FileText,
  Dices,
  KeyRound,
  ArrowRight,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { saveUserProfile } from '../utils/profile';
import { playPress, playWin } from '../utils/sounds';
import {
  type OnboardingState,
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
  tagSuggestions?: string[];
}

function generateRandomHandle(): string {
  const prefixes = ['Cyber', 'Shadow', 'Neon', 'Velvet', 'Midnight', 'Pulse', 'Hyper', 'Ghost', 'Silk', 'Echo', 'Vortex', 'Static'];
  const suffixes = ['Gooner', 'Voyeur', 'Phantom', 'Drifter', 'Rider', 'Specter', 'Seeker', 'Nomad', 'Gridder'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${prefix}${suffix}_${num}`;
}

export function OnboardingFlow({
  identity,
  initialProfile,
  onLogin,
  onCreateAccount,
  onProfileUpdated,
  onComplete,
  onOpenTos,
}: Props) {
  const identityId = identity?.orbitId || null;
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState(identityId));

  // Form states
  const [name, setName] = useState(() => {
    if (initialProfile.displayName && !isDefaultPeerName(initialProfile.displayName)) {
      return initialProfile.displayName;
    }
    return generateRandomHandle();
  });
  const [isImporting, setIsImporting] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Handle returning users / migration
  useEffect(() => {
    if (!identity) return;
    const nextState = readOnboardingState(identityId);
    const anonymous = readOnboardingState(null);
    let migrated = nextState;

    // Returning account holder (finished onboarding under the anonymous key, or
    // already has a real display name): login-onboarding is complete. Idle
    // starter tags are handled by the clicker itself, so don't re-show the wall.
    if (
      nextState.completed.length === 0 &&
      (anonymous.completed.includes('ready') || !isDefaultPeerName(initialProfile.displayName))
    ) {
      migrated = { version: 1, completed: ['welcome', 'ready'], current: 'ready' };
    }

    if (migrated !== nextState) {
      writeOnboardingState(identityId, migrated);
      setState(migrated);
    }
  }, [identity, identityId, initialProfile.displayName]);

  // Sync state changes to storage
  useEffect(() => {
    writeOnboardingState(identityId, state);
  }, [identityId, state]);

  if (isOnboardingComplete(state)) return null;

  const handleRandomize = () => {
    playPress(500);
    setName(generateRandomHandle());
  };

  const handleEnter = async () => {
    if (!ageConfirmed || busy) return;
    const effectiveName = name.trim() || generateRandomHandle();

    setBusy(true);
    setError('');

    try {
      // 1. Confirm age verification in localStorage
      try {
        localStorage.setItem('goonMatch_age_verified', 'true');
      } catch {}

      // 2. Authenticate or create account
      if (isImporting) {
        if (!secretKey.trim()) {
          throw new Error('Please enter your exported secret key');
        }
        await onLogin(effectiveName, initialProfile.tags.join(','), secretKey.trim(), initialProfile.pfpUrl);
      } else if (!identity) {
        await onCreateAccount(effectiveName, initialProfile.tags.join(','), initialProfile.pfpUrl);
      } else {
        await saveUserProfile(identity, { display_name: effectiveName });
        onProfileUpdated({ displayName: effectiveName, tags: initialProfile.tags, pfpUrl: initialProfile.pfpUrl });
      }

      playWin();

      // 3. Account ready — onboarding ends here. Idle starter tags are asked
      //    for the first time the player opens the idle clicker (GridWorkspace
      //    gates itself on setupComplete), so the rest of gMatch is usable
      //    immediately instead of blocking login on a tag wall.
      const nextState: OnboardingState = { version: 1, completed: ['welcome', 'ready'], current: 'ready' };
      writeOnboardingState(identityId, nextState);
      setState(nextState);
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete setup');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[99990] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-zinc-100">
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-xl p-6 sm:p-8 shadow-2xl space-y-6 animate-orbit-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              <Sparkles className="w-3 h-3 text-zinc-300" />
              <span>Decentralized Adult Network</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Welcome to gMatch
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Fast, privacy-preserving adult media and peer-to-peer card gaming.
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
        </div>

        {/* Legal & Privacy Advisory Box */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/40 p-4 space-y-3">
          <div className="flex items-start gap-2.5 text-xs">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">18+ Mature Content Only</span>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                gMatch contains adult media and community content intended exclusively for adults. You must be at least 18 years old to access this platform.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">Local-First &amp; P2P Privacy</span>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Your cryptographic keys and preferences remain securely on your device. We do not sell your personal data or track your behavior across platforms.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs">
            <Scale className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">Zero Tolerance Policy</span>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Strict zero tolerance for non-consensual imagery, underage material, or illegal content.
              </p>
            </div>
          </div>

          <div className="pt-1 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={() => { playPress(700); onOpenTos(); }}
              className="text-[11px] text-zinc-400 hover:text-white underline underline-offset-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Read Full Terms of Service &amp; Privacy Policy</span>
            </button>
          </div>
        </div>

        {/* Form: Account & Identity */}
        <div className="space-y-4">
          {!isImporting ? (
            <div className="space-y-1.5">
              <label htmlFor="onboarding-display-name" className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>Display Name</span>
                <span className="text-[10px] text-zinc-500 font-normal">Public handle</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="onboarding-display-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. AnonGooner"
                  maxLength={30}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleRandomize}
                  title="Generate random anonymous handle"
                  className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
                >
                  <Dices className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="onboarding-secret-key" className="text-xs font-medium text-zinc-300">
                  Secret Key
                </label>
                <input
                  id="onboarding-secret-key"
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="Paste your exported secret key"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="onboarding-import-name" className="text-xs font-medium text-zinc-300">
                  Display Name (Optional)
                </label>
                <input
                  id="onboarding-import-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Leave blank to use existing name"
                  maxLength={30}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Toggle Import / Create */}
          <button
            type="button"
            onClick={() => { playPress(400); setIsImporting(!isImporting); }}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{isImporting ? 'Create new anonymous identity instead' : 'Returning user? Import secret key'}</span>
          </button>
        </div>

        {/* Checkbox Gate */}
        <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => { playPress(600); setAgeConfirmed(e.target.checked); }}
            className="w-4 h-4 mt-0.5 rounded border-zinc-700 bg-zinc-900 text-white accent-white cursor-pointer"
          />
          <span className="text-xs text-zinc-300 leading-snug">
            I confirm that I am at least <strong>18 years of age</strong>, and I agree to the{' '}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playPress(700);
                onOpenTos();
              }}
              className="text-white underline underline-offset-2 hover:text-zinc-200"
            >
              Terms of Service &amp; Privacy Policy
            </button>
            .
          </span>
        </label>

        {error && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Submit / Enter Action */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleEnter}
            disabled={busy || !ageConfirmed || (!name.trim() && !isImporting) || (isImporting && !secretKey.trim())}
            className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-zinc-200 active:scale-[0.99] text-black font-semibold text-xs shadow-sm transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
          >
            {busy ? (
              <span>Configuring Account...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
