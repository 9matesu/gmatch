import { useGame } from '../game/store'

export default function Header() {
  const nsfwBlur = useGame((s) => s.nsfwBlur)
  const toggleBlur = useGame((s) => s.toggleBlur)
  return (
    <header className="app-header glass">
      <h1 className="brand">
        Goon<span className="brand-accent">Grid</span>
      </h1>
      <span className="brand-sub">babecock idle · 18+</span>
      <div className="header-spacer" />
      <button
        type="button"
        className={`blur-toggle ${nsfwBlur ? 'on' : ''}`}
        onClick={toggleBlur}
        title="Blur images until hover"
      >
        NSFW blur: {nsfwBlur ? 'ON' : 'OFF'}
      </button>
    </header>
  )
}
