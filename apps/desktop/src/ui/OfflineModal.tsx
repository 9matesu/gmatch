import { useGame } from '../game/store'
import { Modal } from '../components/Modal'
import { formatNum } from './format'
import { BTN, BTN_PRIMARY, DISPLAY, MONO } from './styles'

/** Welcome-back overlay — rendered through the shell's shared Modal. */
export default function OfflineModal() {
  const gain = useGame((s) => s.offlineGain)
  const collectOffline = useGame((s) => s.collectOffline)
  if (gain <= 0) return null
  return (
    <Modal title="Welcome back" onClose={collectOffline} maxWidth="max-w-md" dismissable={false}>
      <div className="flex flex-col gap-3.5">
        <h2 className={`${DISPLAY} m-0 text-2xl font-bold uppercase tracking-[1px] text-balance text-retro-fg`}>
          Welcome back, degenerate
        </h2>
        <p className="m-0 text-xs leading-relaxed text-retro-muted">
          Your tags kept working while you were gone:
        </p>
        <div className={`${MONO} ${DISPLAY} text-2xl font-bold text-retro-online`}>
          +{formatNum(gain)} pts
        </div>
        <button type="button" className={`${BTN} ${BTN_PRIMARY}`} onClick={collectOffline}>
          Collect
        </button>
      </div>
    </Modal>
  )
}
