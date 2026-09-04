import { useEffect } from 'react'
import { useGame } from './game/store'
import Header from './ui/Header'
import StatsPanel from './ui/StatsPanel'
import GoonPanel from './ui/GoonPanel'
import ShopPanel from './ui/ShopPanel'
import Toasts from './ui/Toasts'
import OfflineModal from './ui/OfflineModal'
import AgeGate from './ui/AgeGate'
import SetupScreen from './ui/SetupScreen'
import './ui/styles.css'

export default function App() {
  const ageVerified = useGame((s) => s.ageVerified)
  const setupComplete = useGame((s) => s.setupComplete)
  const backgroundUrl = useGame((s) => s.backgroundUrl)

  useEffect(() => {
    useGame.getState().load()
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => useGame.getState().tick(1000), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const save = () => useGame.getState().save()
    const t = window.setInterval(save, 10_000)
    window.addEventListener('beforeunload', save)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('beforeunload', save)
    }
  }, [])

  useEffect(() => {
    if (ageVerified && setupComplete) void useGame.getState().fetchFeed()
  }, [ageVerified, setupComplete])

  return (
    <div className={`app-shell ${backgroundUrl ? 'has-backdrop' : ''}`}>
      {backgroundUrl && (
        <div
          className="app-backdrop"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
          aria-hidden="true"
        />
      )}
      <Header />
      <main className="columns">
        <StatsPanel />
        <GoonPanel />
        <ShopPanel />
      </main>
      <Toasts />
      <OfflineModal />
      {!ageVerified && <AgeGate />}
      {ageVerified && !setupComplete && <SetupScreen />}
    </div>
  )
}
