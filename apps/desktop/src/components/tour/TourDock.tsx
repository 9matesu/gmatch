import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { TourState, TourStep } from '../../firstRun/tourState';
import { BTN, BTN_PRIMARY, BTN_SMALL } from '../../ui/styles';
import { playPress } from '../../utils/sounds';

interface Props {
  steps: TourStep[];
  state: TourState;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourDock({ steps, state, onNext, onBack, onSkip }: Props) {
  const step = steps[Math.min(state.index, steps.length - 1)];
  const last = state.index >= steps.length - 1;
  const label = last ? 'Done' : step.view ? 'Show me' : 'Next';

  return (
    <div className="fixed bottom-4 right-4 z-[var(--z-toast)] w-[320px] max-w-[calc(100vw-2rem)] rounded-lg border border-border-glass bg-retro-panel p-4 shadow-xl select-none">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-retro-muted">
          {state.index + 1} of {steps.length}
        </span>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip tour"
          className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <h3 className="mt-1 text-sm font-medium text-retro-fg">{step.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-retro-body">{step.text}</p>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1 rounded-full transition-colors duration-150 ${
                i === state.index ? 'w-4 bg-retro-fg' : 'w-1 bg-glass-w10'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            disabled={state.index === 0}
            aria-label="Back"
            className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { playPress(); onNext(); }}
            className={`${BTN} ${BTN_SMALL} ${BTN_PRIMARY}`}
          >
            {label}
            {!last && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
