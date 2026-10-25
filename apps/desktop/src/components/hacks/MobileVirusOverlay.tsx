"use client";

import { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { OrbitObject as CardItem } from '@orbit/shared';

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

/**
 * The "virus" hack: the victim's app locks behind a takeover screen for up
 * to 60 seconds. Deliberately calm (no rapid flashing — photosensitivity),
 * and pressing Escape ends it early.
 */
export function MobileVirusOverlay({
  cards = [],
  attackerName = 'someone',
  onComplete,
}: {
  cards?: CardItem[];
  attackerName?: string;
  onComplete?: () => void;
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  // Only the attacker's own cards are shown. With none, the lock screen still
  // works — inventing stock photos would put fake content behind someone's
  // name.
  const images = cards
    .map((c) => c.content_url || (c as any).url || (c as any).data)
    .filter(Boolean);

  useEffect(() => {
    if (reduceMotion || images.length < 2) return;
    const interval = setInterval(() => {
      setActiveImageIndex((prev) => (prev + 1) % images.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [images.length, reduceMotion]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onComplete]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onComplete?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[var(--z-toast)] bg-black flex flex-col items-center justify-between p-4 select-none overflow-hidden font-sans cursor-default">
      <div className="w-full z-20 bg-red-950/90 text-white p-3 rounded-xl border border-red-500/50 shadow-2xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldAlert className="w-6 h-6 text-red-400 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-bold">
              Your screen is locked
            </h1>
            <p className="text-xs text-red-200/80 truncate">
              <strong>@{attackerName}</strong> used a hack from the store on you
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="text-[10px] text-red-200/70 block">ENDS IN</span>
          <span className="text-xl font-bold tabular-nums text-white">{secondsRemaining}s</span>
        </div>
      </div>

      {images.length > 0 && (
        <div className="relative w-full max-w-md aspect-square rounded-xl overflow-hidden border border-red-500/40 shadow-2xl z-10">
          <img
            src={images[activeImageIndex] || images[0]}
            alt=""
            className={`w-full h-full object-cover ${reduceMotion ? '' : 'transition-transform duration-700'}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40 pointer-events-none" />
        </div>
      )}

      <p className="text-xs text-retro-muted z-20 text-center">
        Navigation unlocks when the timer runs out &mdash; or press Escape.
      </p>
    </div>
  );
}
