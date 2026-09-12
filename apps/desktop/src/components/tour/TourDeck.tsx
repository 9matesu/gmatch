"use client";

// One-time onboarding deck: four cards pinned above the timeline, shown on
// the tour's first step (the TourDock covers the rest). Skipping marks the
// tour skipped — same marker as the dock's skip, per identity.

import { TOUR_STEPS, type TourStep } from '../../firstRun/tourState';
import { playPress } from '../../utils/sounds';
import { X } from 'lucide-react';

const DECK_IDS = ['create', 'idle', 'duel', 'messages'];
const DECK: TourStep[] = DECK_IDS
  .map((id) => TOUR_STEPS.find((s) => s.id === id))
  .filter((s): s is TourStep => Boolean(s));

export function TourDeck({ onOpen, onDismiss }: { onOpen: (step: TourStep) => void; onDismiss: () => void }) {
  return (
    <div className="w-full max-w-[1400px] mx-auto px-2 sm:px-4 pt-3">
      <div className="flex items-start justify-between px-1 pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">New here?</span>
        <button
          type="button"
          onClick={() => { playPress(700); onDismiss(); }}
          aria-label="Close guide"
          title="Close guide"
          className="p-1 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {DECK.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => { playPress(820); onOpen(step); }}
            className="text-left rounded-lg border border-border-glass bg-retro-panel p-3 hover:bg-glass-w10 transition-colors cursor-pointer"
          >
            <span className="block text-xs font-semibold text-retro-fg">{step.title}</span>
            <span className="block mt-1 text-[11px] leading-relaxed text-retro-muted line-clamp-2">{step.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
