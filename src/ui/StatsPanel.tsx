import { useGame } from '../game/store'
import { clickPower, passiveGps } from '../game/economy'
import { TITLES, tierForXp, titleForTier, xpForTier } from '../game/prestige'
import { formatNum } from './format'
import { IconBolt, IconCoin, IconCursor, IconShard } from './icons'

export default function StatsPanel() {
  const s = useGame()
  const now = Date.now()
  const input = {
    shards: s.shards,
    achievementsEarned: s.achievements.length,
    tags: s.tags,
    gallery: s.gallery,
    caps: s.caps,
  }
  const gps = passiveGps(input, now)
  const cp = clickPower(input, now)
  const tier = tierForXp(s.xp)
  const cur = xpForTier(tier)
  const next = xpForTier(tier + 1)
  const pct =
    tier >= TITLES.length ? 100 : Math.min(100, Math.max(0, ((s.xp - cur) / (next - cur)) * 100))

  return (
    <aside className="plate panel stats">
      <div className="gp-big mono">{formatNum(s.gp)}</div>
      <div className="gp-label">Goon Points</div>
      <div className="stat-row">
        <span>
          <IconCoin size={13} /> GP/s
        </span>
        <b className="mono">{formatNum(gps)}</b>
      </div>
      <div className="stat-row">
        <span>
          <IconBolt size={13} /> Click power
        </span>
        <b className="mono">{formatNum(cp)}</b>
      </div>
      <div className="stat-row">
        <span>
          <IconCursor size={13} /> Clicks / crits
        </span>
        <b className="mono">
          {s.clicks} / {s.crits}
        </b>
      </div>
      <div className="stat-row">
        <span>
          <IconShard size={13} /> Corruption shards
        </span>
        <b className="mono">{s.shards}</b>
      </div>
      <div className="ladder">
        <div className="ladder-head">
          <span className="ladder-title">Pornification</span>
          <span className="tier-now">
            <span className="tier-name">{titleForTier(tier)}</span>
            <span className="mono tier-num">T{tier}</span>
          </span>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <ol className="tier-list">
          {TITLES.map((t, i) => (
            <li
              key={t}
              className={i + 1 < tier ? 'reached' : i + 1 === tier ? 'current' : 'locked'}
            >
              <span className="mono">{i + 1}</span> {t}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
