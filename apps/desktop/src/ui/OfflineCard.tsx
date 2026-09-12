import { BTN, BTN_SMALL } from './styles'

interface OfflineCardProps {
  /** True while a feed fetch is in flight — dot spins green. */
  fetching: boolean
  /** True when every source failed — dot pulses red. */
  feedOffline: boolean
  onRetry: () => void
}

/** Status dot colors (was .status-dot.loading/.offline/.empty/.live) — shell status tokens. */
const DOT_COLOR = {
  loading: 'bg-retro-online animate-[gg-dot-spin_0.9s_linear_infinite]',
  offline: 'bg-retro-error animate-[gg-dot-pulse_1.1s_ease-in-out_infinite]',
  empty: 'bg-retro-warning',
} as const

/**
 * Simple offline/loading card overlaid on the feed stage (SPEC §6).
 * One status dot, one line, one button — the dot is the visual feedback:
 * green spin = loading, red pulse = offline, amber = empty/idle.
 */
export default function OfflineCard({ fetching, feedOffline, onRetry }: OfflineCardProps) {
  const state = fetching ? 'loading' : feedOffline ? 'offline' : 'empty'
  const label =
    state === 'loading'
      ? 'Loading feed…'
      : state === 'offline'
        ? 'Sources offline. Check your connection.'
        : 'No image — pull the feed'
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-1/2 z-[4] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-xl border border-border-glass bg-glass-strong px-4 py-3"
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className={`h-3 w-3 flex-none rounded-full ${DOT_COLOR[state]}`}
        aria-hidden="true"
      />
      <span className="whitespace-nowrap text-[13px] text-retro-fg">{label}</span>
      <button type="button" className={`${BTN} ${BTN_SMALL}`} disabled={fetching} onClick={onRetry}>
        {fetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}
