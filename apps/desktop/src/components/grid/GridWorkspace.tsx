import { useEffect } from 'react'
import GoonPanel from '../../ui/GoonPanel'
import ShopPanel from '../../ui/ShopPanel'
import StatsPanel from '../../ui/StatsPanel'
import OfflineModal from '../../ui/OfflineModal'
import SetupScreen from '../../ui/SetupScreen'
import { useToast } from '../Toast'
import { useGame } from '../../game/store'
import '../../ui/goongrid.css'

/**
 * "Babecock · Idle" workspace (plan D2/D5): the GoonGrid idle game as a view
 * inside the goonMatch shell. Layout + panels still use the legacy goongrid
 * stylesheet (scoped .goongrid-root) until the Tailwind restyle lands.
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
    <div className="goongrid-root h-full min-h-0">
      <div className="app-shell">
        <main className="columns">
          <StatsPanel />
          <GoonPanel />
          <ShopPanel />
        </main>
        <OfflineModal />
        {ageVerified && !setupComplete && <SetupScreen />}
      </div>
    </div>
  )
}
