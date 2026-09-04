import { useState } from 'react'
import { useGame } from '../game/store'
import { formatNum } from './format'
import { IconSkull } from './icons'

export default function Header() {
  const defeated = useGame((s) => s.defeated)
  const toasts = useGame((s) => s.toasts)
  const dismissToast = useGame((s) => s.dismissToast)
  const clearToasts = useGame((s) => s.clearToasts)
  const [open, setOpen] = useState(false)
  return (
    <header className="app-header plate">
      <h1 className="brand">
        Goon<span className="brand-accent">Grid</span>
      </h1>
      <span className="brand-sub">babecock idle · 18+</span>
      <div className="header-spacer" />
      <span className="ko-count mono" title="Lifetime KOs — each foe hits harder">
        <IconSkull size={13} /> KOs: {formatNum(defeated)}
      </span>
      <div className="notif-wrap">
        <button
          type="button"
          className={`btn small notif-btn ${toasts.length > 0 ? 'pulse' : ''}`}
          aria-label={`Notifications (${toasts.length})`}
          aria-expanded={open}
          title={toasts.length > 0 ? `${toasts.length} notifications — open the log` : 'No notifications'}
          onClick={() => setOpen((o) => !o)}
        >
          🔔 <span className="mono">{toasts.length}</span>
        </button>
        {open && (
          <div className="notif-panel glass" role="log" aria-label="Notifications">
            <div className="notif-head">
              <span>Notifications</span>
              {toasts.length > 0 && (
                <button type="button" className="btn small" onClick={clearToasts}>
                  Clear
                </button>
              )}
            </div>
            {toasts.length === 0 ? (
              <div className="muted notif-empty">Nothing yet — KOs, achievements and pops land here.</div>
            ) : (
              <ul className="notif-list">
                {[...toasts].reverse().map((t) => (
                  <li key={t.id} className="notif-row">
                    <span className="notif-msg">{t.msg}</span>
                    <button
                      type="button"
                      className="btn small notif-x"
                      aria-label="Dismiss notification"
                      onClick={() => dismissToast(t.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
