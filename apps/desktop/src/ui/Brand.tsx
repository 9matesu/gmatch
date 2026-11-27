"use client";

/**
 * The ONE brand lockup. Every surface that shows the name (title bar, boot
 * splash's static twin, onboarding, age gate) renders this component — the
 * mark is the shipped icon.svg, the wordmark is live text, and mark size, gap,
 * clear-space and the minimum size all come from `LOGO` in ui/tokens.ts.
 *
 * No baked raster wordmark, no second face, no new colour: the name wears the
 * existing fg role and the compact variant only changes the type step so the
 * lockup fits a 36px title bar.
 */
import { classes, LOGO } from './tokens'

export interface BrandProps {
  /** `compact` fits the 36px title bar; `hero` is the splash/onboarding scale.
   *  All three use the same mark asset, gap, clear-space and minimum size. */
  size?: 'default' | 'compact' | 'hero'
  /** Mark alone, where there is no room for the name. Still announced as gMatch. */
  markOnly?: boolean
  /** Extra clear-space on the OUTSIDE of the lockup (the token's own space is
   *  already inside); callers use this for alignment, never for re-spacing. */
  className?: string
}

export function Brand({ size = 'default', markOnly = false, className = '' }: BrandProps) {
  const compact = size === 'compact'
  const markClass = size === 'hero' ? LOGO.markHero : compact ? LOGO.markCompact : LOGO.mark
  return (
    <span
      className={classes(LOGO.lockup, className)}
      {...(markOnly ? { role: 'img', 'aria-label': 'gMatch' } : {})}
    >
      <img
        src={LOGO.markSrc}
        alt=""
        aria-hidden="true"
        className={markClass}
      />
      {!markOnly && (
        <span
          className={
            size === 'hero' ? LOGO.wordmarkHero : compact ? LOGO.wordmarkCompact : LOGO.wordmark
          }
        >
          gMatch
        </span>
      )}
    </span>
  )
}
