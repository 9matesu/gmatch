/**
 * Progressive damage tint for the clicker stage.
 *
 * Feedback used to be a per-click CSS shake on the tile itself, which had to be
 * retriggered by bumping the tile's React `key`. That remounted the whole
 * subtree, so the <img> re-decoded (a visible flash) and the <video> restarted
 * from 0: the "clicking makes the media blink / restart" bug. The shake now
 * runs on a keyed child instead, leaving the media element's identity alone.
 *
 * This component is the missing half: a colour wash that deepens as the foe's
 * HP falls, so the stage reads as "how close is this to dying" at a glance.
 * `dmg` is 0 at full health and 1 at the killing blow, and `flashKey` bumps per
 * hit so the spike above it restarts.
 */
import { MONO } from './styles';

export function DamageTint({
  dmg,
  flashKey,
  crit,
  reducedMotion,
}: {
  /** 0 = untouched, 1 = dead. */
  dmg: number;
  /** Bumps per hit; only its parity is read, to alternate the animation name. */
  flashKey: number;
  crit?: boolean;
  reducedMotion?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, dmg));
  if (clamped <= 0) return null;

  // Rose for damage, hot amber on a crit, so the two reads are distinguishable
  // without relying on colour alone (the CRIT banner is the non-colour cue).
  const wash = crit
    ? 'radial-gradient(circle at 50% 50%, rgba(251,191,36,0.85), rgba(244,63,94,0.55) 70%, transparent 100%)'
    : 'radial-gradient(circle at 50% 50%, rgba(244,63,94,0.8), rgba(190,18,60,0.45) 70%, transparent 100%)';

  return (
    <>
      {/* The progressive part: opacity tracks damage, so it is already 0 at
          full health and only becomes visible as the foe is worn down. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[3] transition-opacity duration-150 ease-out"
        style={{ background: wash, opacity: clamped * 0.75 }}
      />
      {/* The per-hit part. gg-hit-flash-a / -b are identical keyframes, so
          alternating the NAME restarts the animation in place — no `key`, so
          nothing underneath is remounted. */}
      {!reducedMotion && (
        <span
          aria-hidden="true"
          data-testid="goon-hit-flash"
          className={`${MONO} pointer-events-none absolute inset-0 z-[4] ${flashKey % 2 ? 'animate-[gg-hit-flash-b_0.22s_ease-out]' : 'animate-[gg-hit-flash-a_0.22s_ease-out]'}`}
          style={{ background: wash }}
        />
      )}
    </>
  );
}
