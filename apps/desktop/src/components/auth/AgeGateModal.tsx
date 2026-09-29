"use client";

import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { playPress, playWin } from '../../utils/sounds';

export function AgeGateModal({
  onOpenTos,
}: {
  onOpenTos?: () => void;
}) {
  // Read synchronously so the gate never flashes the login screen behind it.
  // The age check runs BEFORE onboarding (it is step 1 of the social flow);
  // the goonMatch_age_verified key intentionally survives logout.
  const [isVerified, setIsVerified] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('goonMatch_age_verified') === 'true';
    } catch {
      return true;
    }
  });

  const handleConfirmAge = () => {
    playWin();
    try {
      localStorage.setItem('goonMatch_age_verified', 'true');
    } catch {}
    setIsVerified(true);
  };

  const handleRejectAge = () => {
    playPress(400);
    window.location.href = 'https://www.google.com';
  };

  if (isVerified) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      className="fixed inset-0 z-[var(--z-toast)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in"
    >
      <div
        className="bg-retro-bg border border-border-glass rounded-xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 text-center flex flex-col items-center animate-orbit-slide-up text-retro-fg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon & Brand */}
        <div className="w-12 h-12 rounded-xl bg-retro-panel border border-border-glass text-retro-fg flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-retro-fg" />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-retro-body bg-retro-panel px-2.5 py-1 rounded-md border border-border-glass">
            Age Verification
          </span>
          <h2 id="age-gate-title" className="text-xl font-semibold text-white tracking-tight">Are you 18 or older?</h2>
          <p className="text-xs text-retro-body leading-relaxed max-w-xs mx-auto">
            gMatch contains adult media and community content intended exclusively for mature audiences (18+).
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full space-y-2 pt-1">
          <button
            type="button"
            autoFocus
            onClick={handleConfirmAge}
            className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-retro-fg active:scale-[0.99] text-black font-semibold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>I am 18 or Older. Enter</span>
          </button>

          <button
            type="button"
            onClick={handleRejectAge}
            className="w-full py-2 px-4 rounded-lg bg-retro-panel hover:bg-glass-w12 active:scale-[0.99] text-retro-fg font-medium text-xs border border-border-glass transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4 text-retro-muted" />
            <span>Under 18. Exit</span>
          </button>
        </div>

        {/* Footer info link */}
        {onOpenTos && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenTos(); }}
            className="text-xs text-retro-muted hover:text-retro-fg underline font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <FileText className="w-3 h-3" />
            <span>Terms of Service &amp; Privacy Policy</span>
          </button>
        )}
      </div>
    </div>
  );
}
