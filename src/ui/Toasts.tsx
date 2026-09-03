import { useEffect } from 'react'
import { useGame } from '../game/store'

export default function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const dismissToast = useGame((s) => s.dismissToast)
  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) => window.setTimeout(() => dismissToast(t.id), 3200))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [toasts, dismissToast])
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast glass" onClick={() => dismissToast(t.id)}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
