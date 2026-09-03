import { useGame } from '../game/store'
import { formatNum } from './format'

export default function Header() {
  const defeated = useGame((s) => s.defeated)
  return (
    <header className="app-header glass">
      <h1 className="brand">
        Goon<span className="brand-accent">Grid</span>
      </h1>
      <span className="brand-sub">babecock idle · 18+</span>
      <div className="header-spacer" />
      <span className="ko-count mono" title="Lifetime KOs — each foe hits harder">
        KOs: {formatNum(defeated)}
      </span>
    </header>
  )
}
