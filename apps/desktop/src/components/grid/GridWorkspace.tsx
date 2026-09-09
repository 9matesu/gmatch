import { useEffect } from 'react'
import GoonPanel from '../../ui/GoonPanel'
import ShopPanel from '../../ui/ShopPanel'
import StatsPanel from '../../ui/StatsPanel'
import OfflineModal from '../../ui/OfflineModal'
import { useToast } from '../Toast'
import { useGame } from '../../game/store'
import '../../ui/grid-animations.css'

/**
 * "Babecock · Idle" workspace (plan D2/D5): the gMatch idle game as a view
 * inside the gMatch shell. Panels are styled with Tailwind utilities
 * (src/ui/styles.ts); only the game's keyframes live in a stylesheet.
 */
export default function GridWorkspace() {
  const ageVerified = useGame((s) => s.ageVerified)
  const setupComplete = useGame((s) => s.setupComplete)
  const toasts = useGame((s) => s.toasts)
  const { toast } = useToast()

  // The shell's AgeGateModal is the single 18+ gate (plan 5.5): mirror it
  // into the idle store so offline earnings + feed unlock the same way.
  useEffect(() => {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('goonMatch_age_verified') === 'true' &&
      !useGame.getState().ageVerified
    ) {
      useGame.getState().verifyAge()
    }
  }, [])

  // Store toasts (KOs, purchases, unlocks) surface through the shell's toast
  // system — the legacy floating overlay + header bell are gone (plan 5.4).
  // Forwarded batches are cleared so the store queue never grows.
  useEffect(() => {
    if (toasts.length === 0) return
    for (const t of toasts) toast(t.msg, 'info')
    useGame.getState().clearToasts()
  }, [toasts, toast])

  // First feed pull once the player's own tags exist (was in old App.tsx).
  useEffect(() => {
    if (ageVerified && setupComplete) void useGame.getState().fetchFeed()
  }, [ageVerified, setupComplete])

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-surface-canvas p-3">
      <main className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px] gap-3 max-[1100px]:block max-[1100px]:overflow-y-auto">
        <StatsPanel />
        <GoonPanel />
        <ShopPanel />
      </main>
      <OfflineModal />
    </div>
  )
}
