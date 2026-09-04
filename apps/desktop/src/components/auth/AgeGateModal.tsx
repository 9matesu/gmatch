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
    <div className="fixed inset-0 z-[99995] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 font-sans animate-orbit-fade-in">
      <div
        className="bg-surface-raised border border-border-glass rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 text-center flex flex-col items-center animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon & Brand */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-cyan-900/20">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/30">
            Age Verification
          </span>
          <h2 className="text-xl font-black text-retro-fg tracking-tight">Are you 18 or older?</h2>
          <p className="text-xs text-retro-muted leading-relaxed max-w-xs mx-auto">
            goonMatch contains community-shared artwork and social media moments intended exclusively for mature audiences.
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full space-y-2.5 pt-1">
          <button
            type="button"
            onClick={handleConfirmAge}
            className="w-full py-3 px-4 rounded-2xl bg-black hover:bg-surface-elevated active:scale-95 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>I am 18 or Older — Enter</span>
          </button>

          <button
            type="button"
            onClick={handleRejectAge}
            className="w-full py-2.5 px-4 rounded-2xl bg-surface-interactive hover:bg-white/15 active:scale-95 text-retro-body font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <XCircle className="w-4 h-4 text-retro-muted" />
            <span>Under 18 — Exit</span>
          </button>
        </div>

        {/* Footer info link */}
        {onOpenTos && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenTos(); }}
            className="text-[11px] text-retro-muted hover:text-retro-body underline font-medium inline-flex items-center gap-1 cursor-pointer"
          >
            <FileText className="w-3 h-3" />
            <span>Terms of Service &amp; Privacy Policy</span>
          </button>
        )}
      </div>
    </div>
  );
}
