import { create } from 'zustand'

/**
 * mediaq setup state — a module-level store so the install survives the modal
 * being closed ("send to background") and can be surfaced in the notification
 * centre. The main process owns the work; this mirrors its progress events and
 * drives the IPC. The app is fully usable offline, so a skipped/failed install
 * never blocks anything.
 */

export type MediaqInstallStatus = 'idle' | 'installing' | 'done' | 'error' | 'cancelled'

export interface MediaqInstallState {
  /** Modal visibility. Closing it = background; the install keeps running. */
  open: boolean
  status: MediaqInstallStatus
  /** Determinate percent (0-100) or null for an indeterminate phase. */
  percent: number | null
  message: string
  openModal: () => void
  closeModal: () => void
  /** `showModal=false` installs inline (Settings); progress still lives in this
   *  store, so the notification centre and the setup modal stay in sync. */
  start: (showModal?: boolean) => void
  cancel: () => void
  reset: () => void
}

let progressUnsub: (() => void) | null = null

/** Subscribe to main-process progress once, for the lifetime of the app. */
function ensureProgressListener(): void {
  if (progressUnsub) return
  const g = window.gmatch
  if (!g?.onMediaqProgress) return
  progressUnsub = g.onMediaqProgress((p) => {
    if (p.phase === 'done') {
      useMediaqInstall.setState({ status: 'done', percent: 100, message: p.message || 'mediaq is ready' })
    } else if (p.phase === 'error') {
      useMediaqInstall.setState({ status: 'error', message: p.message || 'install failed' })
    } else if (p.phase === 'cancelled') {
      useMediaqInstall.setState({ status: 'cancelled', message: 'cancelled' })
    } else {
      useMediaqInstall.setState({
        status: 'installing',
        percent: typeof p.percent === 'number' ? p.percent : null,
        message: p.message || 'Installing…',
      })
    }
  })
}

export const useMediaqInstall = create<MediaqInstallState>((set) => ({
  open: false,
  status: 'idle',
  percent: null,
  message: '',
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }), // background; the install continues
  start: (showModal = true) => {
    ensureProgressListener()
    set({ open: showModal, status: 'installing', percent: null, message: 'Starting…' })
    const g = window.gmatch
    if (!g?.mediaqInstall) {
      set({ status: 'error', message: 'mediaq setup needs the gMatch desktop app' })
      return
    }
    void g
      .mediaqInstall()
      .then((res) => {
        if (res.cancelled) {
          set({ status: 'cancelled', message: 'cancelled' })
        } else if (res.ok) {
          set({ status: 'done', percent: 100, message: 'mediaq is ready' })
        } else {
          set({ status: 'error', message: res.error || 'install failed' })
        }
      })
      .catch((err) => set({ status: 'error', message: String((err as Error)?.message || err) }))
  },
  cancel: () => {
    const g = window.gmatch
    if (g?.mediaqCancel) void g.mediaqCancel()
    set({ status: 'cancelled', message: 'cancelled' })
  },
  reset: () => set({ open: false, status: 'idle', percent: null, message: '' }),
}))