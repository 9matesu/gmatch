"use client";

// A saved node that is not being dialed on this launch (server-mode paused it).
// This is the user's OWN stored address, not a directory row's endpoint_hint —
// directory rows must never print an address at all (see
// ServersView.mask.test.ts), which is why this banner lives in its own file
// and shows the same masked form Settings → Server uses.
import { maskedServerUrl } from '../../utils/ipMask'

export function PausedServerBanner({
  pausedUrl,
  reason,
}: {
  pausedUrl: string
  reason?: 'legacy' | 'unreachable'
}) {
  return (
    <div
      role="status"
      data-testid="paused-server-banner"
      className="mb-2 w-full max-w-[720px] bg-surface-interactive/90 border border-amber-400/40 p-3 rounded-lg space-y-1 shrink-0"
    >
      <p className="text-xs text-retro-fg font-bold">
        {reason === 'unreachable' ? 'Your saved server did not answer' : 'A server from an older version is not dialed'}
      </p>
      <p className="text-xs text-retro-muted">
        This computer is hosting its own world. Nothing was deleted. The address{' '}
        <span className="font-mono break-all">{maskedServerUrl(pausedUrl)}</span>{' '}
        is kept in Settings → Server, where you can reconnect to it or forget it.
      </p>
    </div>
  )
}
