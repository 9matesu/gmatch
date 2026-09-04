import { useState } from 'react'
import { useGame } from '../game/store'

export default function AgeGate() {
  const verifyAge = useGame((s) => s.verifyAge)
  const [ticked, setTicked] = useState(false)
  return (
    <div className="overlay age-gate">
      <div className="glass age-card">
        <h2>18+ only</h2>
        <p>
          GoonGrid is an adults-only idle game. The feed pulls explicit imagery from public booru
          APIs behind a hard safety blocklist. You must be 18 or older (or the age of majority
          where you live) to enter.
        </p>
        <label className="age-check">
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
          />
          I am 18+ and consent to viewing adult content
        </label>
        <button type="button" className="btn btn-primary" disabled={!ticked} onClick={verifyAge}>
          Enter the grid
        </button>
      </div>
    </div>
  )
}
