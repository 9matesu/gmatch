interface OfflineCardProps {
  /** True while a feed fetch is in flight — dot spins green. */
  fetching: boolean
  /** True when every source failed — dot pulses red. */
  feedOffline: boolean
  onRetry: () => void
}

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
        ? 'Sources offline — check connection'
        : 'No image — pull the feed'
  return (
    <div
      className="offline-stage-card"
      role="status"
      aria-live="polite"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`status-dot ${state}`} aria-hidden="true" />
      <span className="offline-stage-label">{label}</span>
      <button type="button" className="btn small" disabled={fetching} onClick={onRetry}>
        {fetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}
