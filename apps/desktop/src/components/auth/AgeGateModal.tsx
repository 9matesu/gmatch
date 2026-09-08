"use client";

import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { playPress, playWin } from '../../utils/sounds';
import { isOnboardingComplete, readOnboardingState } from '../../firstRun/onboardingState';

export function AgeGateModal({
  onOpenTos,
}: {
  onOpenTos?: () => void;
}) {
  // Read synchronously so the gate never flashes the login screen behind it.
  const [isVerified, setIsVerified] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      // If onboarding is active (not complete), OnboardingFlow is the single unified gate
      if (!isOnboardingComplete(readOnboardingState(null))) {
        return true;
      }
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
    <div className="fixed inset-0 z-[99995] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in">
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 text-center flex flex-col items-center animate-orbit-slide-up text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon & Brand */}
        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-zinc-300" />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded-md border border-zinc-800">
            Age Verification
          </span>
          <h2 className="text-xl font-semibold text-white tracking-tight">Are you 18 or older?</h2>
          <p className="text-xs text-zinc-400 leading-relaxed max-w-xs mx-auto">
            GoonGrid contains adult media and community content intended exclusively for mature audiences (18+).
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full space-y-2 pt-1">
          <button
            type="button"
            onClick={handleConfirmAge}
            className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-zinc-200 active:scale-[0.99] text-black font-semibold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>I am 18 or Older — Enter</span>
          </button>

          <button
            type="button"
            onClick={handleRejectAge}
            className="w-full py-2 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 active:scale-[0.99] text-zinc-300 font-medium text-xs border border-zinc-800 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4 text-zinc-500" />
            <span>Under 18 — Exit</span>
          </button>
        </div>

        {/* Footer info link */}
        {onOpenTos && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenTos(); }}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 underline font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <FileText className="w-3 h-3" />
            <span>Terms of Service &amp; Privacy Policy</span>
          </button>
        )}
      </div>
    </div>
  );
}
