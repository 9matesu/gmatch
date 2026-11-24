import { useCallback, useEffect, useState } from 'react'

/**
 * One-shot mediaq setup suite.
 *
 * On first load, if mediaq is not installed (and the desktop bridge exists), the
 * suite opens ONCE. Closing it (or finishing the install) writes a flag so it
 * never nags again — the app is fully usable offline without mediaq, so this is
 * a convenience, not a gate.
 */

const SETUP_KEY = 'gmatch.mediaq.setup.v1'

function alreadyShown(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === '1'
  } catch {
    return true // private mode: do not nag
  }
}

export function useMediaqSetup() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (alreadyShown()) return
    const g = window.gmatch
    if (!g?.mediaqStatus) return // browser build: no bridge, nothing to install
    let live = true
    void g
      .mediaqStatus()
      .then((st) => {
        if (!live) return
        if (!st.installed) setOpen(true)
      })
      .catch(() => {
        /* offline probe failed: try again next launch */
      })
    return () => {
      live = false
    }
  }, [])

  const openSetup = useCallback(() => setOpen(true), [])
  const close = useCallback(() => {
    try {
      localStorage.setItem(SETUP_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }, [])
  const installed = useCallback(() => {
    try {
      localStorage.setItem(SETUP_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  return { open, openSetup, close, installed }
}