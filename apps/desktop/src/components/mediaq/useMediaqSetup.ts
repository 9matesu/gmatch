import { useEffect } from 'react'
import { useMediaqInstall } from '../../services/mediaqInstall'

/**
 * One-shot mediaq setup suite.
 *
 * On first load, if mediaq is not installed (and the desktop bridge exists), the
 * suite opens ONCE. It is marked as "shown" once the install finishes or the
 * player closes it, so it never nags — but a mid-install crash leaves it unshown,
 * so it returns next run. The app is fully usable offline without mediaq.
 */

const SETUP_KEY = 'gmatch.mediaq.setup.v1'

function alreadyShown(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === '1'
  } catch {
    return true // private mode: do not nag
  }
}

export function useMediaqSetup(): void {
  useEffect(() => {
    let live = true
    if (!alreadyShown()) {
      const g = window.gmatch
      if (g?.mediaqStatus) {
        void g
          .mediaqStatus()
          .then((st) => {
            if (live && !st.installed) useMediaqInstall.getState().openModal()
          })
          .catch(() => {
            /* offline probe failed: try again next launch */
          })
      }
    }

    // Mark the suite as handled once it is done or explicitly dismissed.
    const unsub = useMediaqInstall.subscribe((s, prev) => {
      if (s.status === prev.status) return
      const settled = s.status === 'done' || (s.status === 'idle' && prev.status !== 'idle')
      if (!settled) return
      try {
        localStorage.setItem(SETUP_KEY, '1')
      } catch {
        /* ignore */
      }
    })

    return () => {
      live = false
      unsub()
    }
  }, [])
}