import { useEffect } from 'react'
import { useGame } from './game/store'
import Header from './ui/Header'
import StatsPanel from './ui/StatsPanel'
import GoonPanel from './ui/GoonPanel'
import ShopPanel from './ui/ShopPanel'
import Toasts from './ui/Toasts'
import OfflineModal from './ui/OfflineModal'
import AgeGate from './ui/AgeGate'
import './ui/styles.css'

export default function App() {
  const ageVerified = useGame((s) => s.ageVerified)

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
    if (ageVerified) void useGame.getState().fetchFeed()
  }, [ageVerified])

  return (
    <div className="app-shell">
      <Header />
      <main className="columns">
        <StatsPanel />
        <GoonPanel />
        <ShopPanel />
      </main>
      <Toasts />
      <OfflineModal />
      {!ageVerified && <AgeGate />}
    </div>
  )
}
