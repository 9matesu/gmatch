"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  ArrowRight,
  Key,
  User,
  Lock,
} from 'lucide-react';
import { BooruSlideshow } from './BooruSlideshow';
import { SecurityWarning } from '../SecurityWarning';
import { userFacingError } from '../../utils/userError';
import { ProfileSetupForm } from '../profile/ProfileSetupForm';
import { profileIsComplete } from '../../utils/profile';

export function GoonMatchLoginPage({
  onLogin,
  onCreateAccount,
  onOpenTos,
  tagSuggestions = [],
}: {
  onLogin: (name: string, tags?: string, customKey?: string, pfpUrl?: string) => Promise<void>;
  onCreateAccount: (name: string, tags?: string, pfpUrl?: string) => Promise<void>;
  onOpenTos?: () => void;
  /** Tag suggestions fed from the user's own in-game (post) tags. */
  tagSuggestions?: string[];
}) {
  const [mode, setMode] = useState<'signup' | 'key'>('signup');
  const [displayName, setDisplayName] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [pfpUrl, setPfpUrl] = useState<string>('');
  const [agreedToTos, setAgreedToTos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setErrorMsg('');

    if (mode === 'key') {
      if (!keyInput.trim()) {
        setErrorMsg('Please enter a valid goonMatch secret key or JSON export');
        return;
      }
      setLoading(true);
      try {
          await onLogin('', '', keyInput.trim(), pfpUrl);
      } catch (err: unknown) {
        setErrorMsg(userFacingError(err, { fallback: 'Could not restore your profile. Please try again.' }));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'signup') {
      const cleanName = displayName.trim();
      if (!profileIsComplete(cleanName, tags, pfpUrl)) {
        setErrorMsg('Display name, at least one tag and a profile picture are required');
        return;
      }
      if (!agreedToTos) {
        setErrorMsg('Please accept the Terms of Service & Privacy Policy to continue');
        return;
      }
      setLoading(true);
      try {
        await onCreateAccount(cleanName, tags.join(','), pfpUrl);
      } catch (err: unknown) {
        setErrorMsg(userFacingError(err, { fallback: 'Could not create your profile. Please try again.' }));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-[100dvh] w-full text-retro-fg flex flex-col justify-between overflow-x-hidden font-sans select-none" style={{ background: '#080A0D' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-retro-accent/3 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-48 h-48 rounded-full bg-cyan-500/3 blur-3xl" />
      </div>

      <main className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-12 flex-1 flex flex-col md:flex-row md:flex-wrap items-center justify-center gap-8 md:gap-10 lg:gap-16 my-auto">
        <div className="flex items-center justify-center shrink-0 order-2 md:order-1">
          <BooruSlideshow />
        </div>

        <div className="w-full max-w-md shrink-0 order-1 md:order-2">
          <div className="glass-panel p-6 sm:p-8 space-y-6">

            <div className="text-center space-y-2">
              <span className="font-sans font-black text-4xl sm:text-5xl tracking-tighter text-retro-fg select-none inline-block">
                <span>goon</span>
                <span className="font-light tracking-normal text-chrome">Match</span>
              </span>
              <h1 className="text-sm font-extrabold text-retro-fg">
                {mode === 'signup' ? 'Create Your Profile' : 'Import Secret Key'}
              </h1>
              <p className="text-xs text-retro-muted max-w-xs mx-auto">
                {mode === 'signup'
                  ? 'Set up your identity to start. Name, tags and profile picture are required.'
                  : 'Restore your profile using your secret key.'}
              </p>
            </div>

            <SecurityWarning />

            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-400 text-xs font-semibold text-center animate-orbit-slide-up">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' ? (
                <>
                  <ProfileSetupForm
                    name={displayName}
                    onName={setDisplayName}
                    tags={tags}
                    onTags={setTags}
                    pfpUrl={pfpUrl}
                    onPfp={setPfpUrl}
                    suggestions={tagSuggestions}
                  />

                  <label className="flex items-start gap-2.5 p-3 rounded-md bg-white/5 border border-border-glass cursor-pointer text-left select-none">
                    <input
                      type="checkbox"
                      checked={agreedToTos}
                      onChange={(e) => setAgreedToTos(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-retro-accent rounded cursor-pointer shrink-0"
                    />
                    <span className="text-[11px] text-retro-muted leading-tight">
                      I confirm I am 18+ and accept the{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); onOpenTos?.(); }}
                        className="text-retro-accent underline underline-offset-2 hover:text-retro-accent-hover font-semibold"
                      >
                        Terms of Service
                      </button>{' '}
                      &amp;{' '}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); onOpenTos?.(); }}
                        className="text-retro-accent underline underline-offset-2 hover:text-retro-accent-hover font-semibold"
                      >
                        Privacy Policy
                      </button>{' '}
                      &amp; Community Guidelines.
                    </span>
                  </label>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-retro-body flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-retro-accent" />
                      <span>Secret Key / Export JSON</span>
                    </label>
                  </div>
                  <textarea
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder='Paste raw 64-character secret key or {"orbitId":"...", "privateKeyHex":"..."}'
                    rows={4}
                    autoFocus
                    required
                    className="w-full bg-surface-raised border border-border-glass focus:border-retro-accent/60 rounded-md p-3.5 text-xs font-mono text-retro-fg placeholder:text-retro-muted outline-none resize-none transition-all"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (mode === 'signup' && (!profileIsComplete(displayName, tags, pfpUrl) || !agreedToTos))}
                onClick={() => playPress(850)}
                className="w-full py-3.5 px-4 rounded-md chrome-accent active:scale-[0.98] text-black font-extrabold text-xs uppercase tracking-wider shadow-[0_4px_12px_rgba(159,227,255,0.2)] transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === 'signup' ? 'Enter goonMatch' : 'Authenticate with Key'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 text-center metro-rule-top">
              {mode === 'signup' ? (
                <button
                  type="button"
                  onClick={() => {
                    playPress(700);
                    setMode('key');
                    setErrorMsg('');
                  }}
                  className="text-xs text-retro-muted hover:text-retro-fg font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5 text-retro-muted" />
                  <span>Already have an account? <strong className="text-retro-accent hover:underline">Log in with Key</strong></span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    playPress(700);
                    setMode('signup');
                    setErrorMsg('');
                  }}
                  className="text-xs text-retro-muted hover:text-retro-fg font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5 text-retro-muted" />
                  <span>New here? <strong className="text-retro-accent hover:underline">Create an account</strong></span>
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
