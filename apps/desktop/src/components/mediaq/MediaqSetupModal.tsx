import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Button } from '../../ui/kit'

/**
 * One-shot "media suite" installer shown to the user (mediaq = the optional real
 * + hentai content provider). It is a convenience: the app is fully usable
 * offline without it. The heavy lifting (download uv → install mediaq → start
 * the sidecar) runs in the main process; this only shows honest progress.
 */

type Phase = 'checking' | 'idle' | 'installing' | 'done' | 'error'

export function MediaqSetupModal({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean
  onClose: () => void
  onInstalled?: () => void
}) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [message, setMessage] = useState('')
  const offRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
    const g = window.gmatch
    if (!g?.mediaqStatus) {
      setPhase('error')
      setMessage('Media suite needs the gMatch desktop app.')
      return
    }
    setPhase('checking')
    setMessage('')
    let live = true
    void g
      .mediaqStatus()
      .then((st) => {
        if (!live) return
        if (st.installed) {
          setPhase('done')
          setMessage('mediaq is already installed')
        } else {
          setPhase('idle')
        }
      })
      .catch(() => {
        if (!live) return
        setPhase('error')
        setMessage('Could not check mediaq status.')
      })
    if (g.onMediaqProgress) {
      offRef.current = g.onMediaqProgress((p) => {
        setMessage(p.message)
        if (p.phase === 'done') setPhase('done')
        else if (p.phase === 'error') setPhase('error')
      })
    }
    return () => {
      live = false
      offRef.current?.()
      offRef.current = null
    }
  }, [open])

  const install = useCallback(async () => {
    const g = window.gmatch
    if (!g?.mediaqInstall) return
    setPhase('installing')
    setMessage('Starting…')
    try {
      const res = await g.mediaqInstall()
      if (res.ok) {
        setPhase('done')
        setMessage('mediaq is ready')
        onInstalled?.()
      } else {
        setPhase('error')
        setMessage(res.error || 'Install failed.')
      }
    } catch (err) {
      setPhase('error')
      setMessage(String((err as Error)?.message || err))
    }
  }, [onInstalled])

  if (!open) return null

  return (
    <Modal title="Media suite" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-retro-muted">
          Set up the optional media provider once. It adds real and niche hentai
          sources; the app works fully offline without it.
        </p>

        <div className="rounded-lg border border-edge bg-glass-w5 p-3 text-xs">
          {phase === 'checking' && <span className="text-retro-muted">Checking…</span>}
          {phase === 'idle' && (
            <span className="text-retro-muted">
              First run downloads a small Python manager and mediaq (~100 MB).
            </span>
          )}
          {phase === 'installing' && (
            <span className="text-retro-accent">{message || 'Installing…'}</span>
          )}
          {phase === 'done' && <span className="text-success-fg">{message}</span>}
          {phase === 'error' && <span className="text-danger-fg">{message}</span>}
        </div>

        <div className="flex justify-end gap-2">
          {(phase === 'idle' || phase === 'error') && (
            <Button variant="primary" onClick={() => void install()}>
              {phase === 'error' ? 'Retry' : 'Install media suite'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {phase === 'done' ? 'Done' : 'Skip for now'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}