import { Modal, Button } from '../../ui/kit'
import { useMediaqInstall } from '../../services/mediaqInstall'

/**
 * One-shot "media suite" installer (mediaq = the optional real + hentai content
  * provider). It is a convenience: the app is fully usable offline without it.
 * The heavy lifting (download uv → install mediaq → start the sidecar) runs in
 * the main process; this reads the shared store so the install survives the
 * modal being closed ("Send to background") and shows in the notification centre.
 */
export function MediaqSetupModal() {
  const { open, status, percent, message, closeModal, start, cancel, reset } = useMediaqInstall()

  if (!open) return null

  return (
    <Modal title="Media suite" onClose={closeModal} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-retro-muted">
          Set up the optional media provider once. It adds real and niche hentai
          sources; the app works fully offline without it.
        </p>

        {status === 'installing' && (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-glass-w8">
              {percent !== null ? (
                <div
                  className="h-full rounded-full bg-retro-accent transition-[width] duration-300"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-retro-accent" />
              )}
            </div>
            <div className="flex justify-between text-2xs text-retro-muted">
              <span className="truncate">{message || 'Installing…'}</span>
              {percent !== null && <span className="tabular-nums">{percent}%</span>}
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="rounded-lg border border-edge bg-glass-w5 p-3 text-xs text-retro-muted">
            First run downloads a small Python manager and mediaq (~100 MB).
          </div>
        )}
        {status === 'done' && (
          <div className="rounded-lg border border-edge bg-glass-w5 p-3 text-xs text-success-fg">
            {message || 'mediaq is ready'}
          </div>
        )}
        {status === 'error' && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger-fg">
            {message || 'Install failed.'}
          </div>
        )}
        {status === 'cancelled' && (
          <div className="rounded-lg border border-edge bg-glass-w5 p-3 text-xs text-warning-fg">
            Cancelled. You can install it later from the notification centre.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {(status === 'idle' || status === 'error' || status === 'cancelled') && (
            <Button variant="primary" onClick={() => start()}>
              {status === 'idle' ? 'Install media suite' : status === 'error' ? 'Retry' : 'Install'}
            </Button>
          )}
          {status === 'installing' && (
            <>
              <Button variant="secondary" onClick={closeModal}>
                Send to background
              </Button>
              <Button variant="danger" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
          {status === 'done' && (
            <Button variant="primary" onClick={reset}>
              Done
            </Button>
          )}
          {(status === 'idle' || status === 'error' || status === 'cancelled') && (
            <Button variant="ghost" onClick={reset}>
              {status === 'idle' ? 'Skip for now' : 'Close'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}