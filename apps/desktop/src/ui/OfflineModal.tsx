import { useGame } from '../game/store'
import { formatNum } from './format'
import { BTN, BTN_PRIMARY, DISPLAY, MONO, PLATE } from './styles'

export default function OfflineModal() {
  const gain = useGame((s) => s.offlineGain)
  const collectOffline = useGame((s) => s.collectOffline)
  if (gain <= 0) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,5,10,0.85)]">
      <div className={`${PLATE} flex max-w-[420px] flex-col gap-3.5 border-t-[3px] border-t-[#ff2d78] p-7`}>
        <h2 className={`${DISPLAY} m-0 text-[26px] font-bold uppercase tracking-[1px] text-balance text-retro-fg`}>
          Welcome back, degenerate
        </h2>
        <p className="m-0 text-[13px] leading-relaxed text-retro-muted">
          Your tags kept working while you were gone:
        </p>
        <div className={`${MONO} ${DISPLAY} text-[34px] font-bold text-[#3fd68c]`}>
          +{formatNum(gain)} g$
        </div>
        <button type="button" className={`${BTN} ${BTN_PRIMARY}`} onClick={collectOffline}>
          Collect
        </button>
      </div>
    </div>
  )
}
