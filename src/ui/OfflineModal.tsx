import { useGame } from '../game/store'
import { formatNum } from './format'

export default function OfflineModal() {
  const gain = useGame((s) => s.offlineGain)
  const collectOffline = useGame((s) => s.collectOffline)
  if (gain <= 0) return null
  return (
    <div className="overlay">
      <div className="glass offline-card">
        <h2>Welcome back, degenerate</h2>
        <p>Your tags kept working while you were gone:</p>
        <div className="offline-gain mono">+{formatNum(gain)} GP</div>
        <button type="button" className="btn primary" onClick={collectOffline}>
          Collect
        </button>
      </div>
    </div>
  )
}
