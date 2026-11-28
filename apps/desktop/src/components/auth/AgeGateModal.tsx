"use client";

import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { playPress } from '../../utils/sounds';
import { Brand } from '../../ui/Brand';
import { classes, MOTION } from '../../ui/tokens';

export function AgeGateModal() {
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
    try {
      localStorage.setItem('goonMatch_age_verified', 'true');
    } catch {}
    setIsVerified(true);
  };

  const handleRejectAge = () => {
    playPress(400);
    if (window.gmatch?.winClose) window.gmatch.winClose();
    else window.close();
  };

  if (isVerified) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      className={classes('fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans', MOTION.keyframe.fadeIn)}
    >
      <div
        className={classes('bg-retro-bg border border-edge rounded-xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 text-center flex flex-col items-center', MOTION.keyframe.slideUp, 'text-retro-fg')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Brand lockup + the age icon: the shipped icon.png mark (LOGO.markSrc)
            renders at the hero size here and in onboarding, so both first-run
            surfaces show the same brand asset. The 18+ decision is unchanged. */}
        <Brand size="hero" />
        <div className="w-12 h-12 rounded-xl bg-retro-panel border border-edge text-retro-fg flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-retro-fg" />
        </div>

        <div className="space-y-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wider text-retro-body bg-retro-panel px-2.5 py-1 rounded-md border border-edge">
            Age Verification
          </span>
          <h2 id="age-gate-title" className="text-2xl font-black tracking-tighter text-retro-fg">Are you 18 or older?</h2>
          <p className="text-xs text-retro-body leading-relaxed max-w-xs mx-auto">
            gMatch contains adult media and community content intended exclusively for mature audiences (18+).
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full space-y-2 pt-1">
          <button
            type="button"
            onClick={handleConfirmAge}
            className={`w-full py-2.5 px-4 rounded-lg bg-retro-accent hover:bg-retro-fg active:scale-(--scale-press) text-retro-accent-text font-semibold text-xs shadow-sm ${MOTION.transition.quick} cursor-pointer flex items-center justify-center gap-2`}
          >
            <CheckCircle2 className="w-4 h-4 text-success-fg" />
            <span>I am 18 or Older. Enter</span>
          </button>

          <button
            type="button"
            onClick={handleRejectAge}
            className={`w-full py-2 px-4 rounded-lg bg-retro-panel hover:bg-glass-w12 active:scale-(--scale-press) text-retro-fg font-medium text-xs border border-edge ${MOTION.transition.quick} cursor-pointer flex items-center justify-center gap-2`}
          >
            <XCircle className="w-4 h-4 text-retro-muted" />
            <span>Under 18. Exit</span>
          </button>
        </div>
      </div>
    </div>
  );
}
