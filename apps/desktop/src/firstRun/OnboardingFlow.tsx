"use client";

// Social onboarding: the 18+ gate lives in AgeGateModal (rendered above this
// wall); this is server picker → profile only. Joining a server stamps
// SERVER_MARKER_KEY and relaunches; the post-restart mount resumes at profile.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Dices,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { API_BASE, orbitFetch } from '../utils/api';
import { getCentralApiUrl, setCentralApiUrl } from '../utils/central';
import { normalizeServerUrl } from '../utils/serverUrl';
import { joinServer } from '../utils/join-server';
import {
  SERVER_MARKER_KEY,
  type OnboardingState,
  isOnboardingComplete,
  readOnboardingState,
  writeOnboardingState,
} from './onboardingState';
import { sortDirectoryServers, type ServerSort } from './serverSort';
import { saveUserProfile } from '../utils/profile';
import { playPress, playWin } from '../utils/sounds';
import { isDefaultPeerName } from '@orbit/shared';
import type { DirectoryServer } from '../components/servers/ServersView';

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
}

function sameOrigin(a: string, b: string): boolean {
  return a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
}

export function OnboardingFlow(props: Props) {
  const { identity, initialProfile } = props;
  const identityId = identity?.orbitId || null;
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState(identityId));
  const [step, setStep] = useState<'server' | 'profile'>(() => {
    try {
      const marker = localStorage.getItem(SERVER_MARKER_KEY);
      return marker && sameOrigin(marker, API_BASE) ? 'profile' : 'server';
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

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg">
      <div className="w-full max-w-2xl bg-retro-bg border border-border-glass rounded-xl p-6 sm:p-8 shadow-2xl space-y-5 animate-orbit-slide-up">
        {step === 'server' ? (
          <ServerStep
            identity={identity}
            ensureIdentity={props.ensureIdentity}
            onChosen={() => setStep('profile')}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}

function ServerStep({ identity, ensureIdentity, onChosen }: {
  identity: OrbitIdentity | null;
  ensureIdentity: Props['ensureIdentity'];
  onChosen: () => void;
}) {
  const central = useMemo(() => getCentralApiUrl(), []);
  const [servers, setServers] = useState<DirectoryServer[]>([]);
  const [sort, setSort] = useState<ServerSort>('players');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The directory hides join addresses from anonymous callers, so the picker
  // needs a local keypair FIRST (no server-side profile exists yet — that is
  // saved in ProfileStep on the chosen node). createIdentity() also wipes
  // stale per-user storage, which is exactly the "fresh account" posture.
  useEffect(() => {
    if (!identity) void ensureIdentity();
    // mount-once: identity arrives via props afterward; the fetch effect below
    // reacts to it.
  }, []);

  useEffect(() => {
    if (!central || !identity) return;
    let cancelled = false;
    setError('');
    (async () => {
      try {
        // cache-bust: orbitFetch dedups/caches GETs; the list must be fresh
        const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity);
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not reach the server network.');
          return;
        }
        const data = (await res.json()) as { servers: DirectoryServer[] };
        if (!cancelled) setServers(Array.isArray(data.servers) ? data.servers : []);
      } catch {
        if (!cancelled) setError('Could not reach the server network.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [central, identity, nonce]);

  const join = async (s: DirectoryServer) => {
    if (busy || !identity) return;
    setBusy(true);
    const raw = s.endpoint_hint || '';
    const target = raw ? normalizeServerUrl(raw) || normalizeServerUrl('http://' + raw) || raw : '';
    if (!window.gmatch?.serverSet || (target && sameOrigin(target, API_BASE))) {
      // dev/browser build, or already on this node: no restart possible —
      // continue on the current node instead of dead-ending the flow.
      try {
        localStorage.setItem(SERVER_MARKER_KEY, API_BASE);
      } catch { /* private mode */ }
      onChosen();
    } else {
      await joinServer(s, () => { /* toasts irrelevant — app relaunches */ });
    }
    setBusy(false);
  };

  const sorted = useMemo(() => sortDirectoryServers(servers, central, sort), [servers, central, sort]);

  if (!central) {
    return <CentralSetup onSaved={() => setNonce((n) => n + 1)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Choose your server</h1>
          <p className="text-xs text-retro-muted">Pick a community to join. Your profile comes next.</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            aria-label="Sort servers"
            value={sort}
            onChange={(e) => setSort(e.target.value as ServerSort)}
            className="glass-field px-2 py-1 text-xs font-medium"
          >
            <option value="players">Most players</option>
            <option value="name">Name</option>
          </select>
          <button
            type="button"
            onClick={() => { playPress(780); setNonce((n) => n + 1); }}
            aria-label="Refresh servers"
            className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="glass-inset p-3 text-xs text-retro-muted rounded-xl space-y-2">
          <p>{error} The directory at <span className="font-mono">{central.replace(/^https?:\/\//, '')}</span> may be offline.</p>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto styled-scrollbar pr-0.5">
        {!error && sorted.length === 0 && (
          <li className="glass-inset p-4 text-xs text-retro-muted text-center rounded-xl">
            {identity ? 'No servers online right now. Create one later from the Servers tab.' : 'Connecting…'}
          </li>
        )}
        {sorted.map((s) => (
          <li key={s.id} className="glass-inset p-2.5 flex items-center gap-2.5 rounded-xl hover:border-border-strong transition-colors">
            <div className="p-1.5 rounded-lg glass-panel shrink-0 text-retro-accent"><Globe className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-retro-fg truncate">{s.name}</span>
                {!!s.password_required && <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="password required" />}
              </div>
              {s.description && <p className="text-xs text-retro-muted truncate mt-0.5">{s.description}</p>}
              <p className="mt-0.5 text-[10px] text-retro-muted font-mono">
                <strong className="text-emerald-400">{s.online_count ?? '—'}</strong> online · {s.user_count ?? '?'} members
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !identity}
              onClick={() => void join(s)}
              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-30"
            >
              <UserPlus className="w-3 h-3" /> Join
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-retro-muted flex items-center gap-1.5">
        <KeyRound className="w-3 h-3" /> No account yet — one is created for you on the server you pick.
      </p>
    </div>
  );
}

function CentralSetup({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    const raw = url.trim();
    const normalized = raw && (normalizeServerUrl(raw) || normalizeServerUrl(`http://${raw}`));
    if (!normalized) {
      setErr('That does not look like an http(s) address (e.g. https://gmatch.fly.dev).');
      return;
    }
    setCentralApiUrl(normalized);
    setErr('');
    onSaved();
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold tracking-tight text-white">Connect to the network</h1>
      <p className="text-xs text-retro-muted">No central directory is configured, so there is no server list to browse. Add one to continue.</p>
      <label className="block text-xs text-retro-muted">
        Central node URL
        <input
          aria-label="Central node URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://gmatch.fly.dev"
          maxLength={120}
          className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs font-mono"
        />
      </label>
      {err && <p role="alert" className="text-xs text-rose-400">{err}</p>}
      <button
        type="button"
        onClick={save}
        disabled={!url.trim()}
        className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-30"
      >
        Continue
      </button>
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
          <p className="text-xs text-retro-muted">Only your name is required — everything else you can add later.</p>
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
