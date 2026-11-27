"use client";

import { useState } from 'react';
import { BADGES, getLockedBadges, getUnlockedBadges } from '../../game/badges';
import type { BadgeDef } from '../../game/badges';
import { usePlayerStats } from '../../game/playerStats';
import { CHROME, COLOR, GAP, PADDING, RARITY, TYPE, WEIGHT, classes } from '../../ui/tokens';

const DEFAULT_MAX_VISIBLE = 6;

interface BadgeShelfProps {
  /** Heading shown above the chips. */
  title?: string;
  /** Earned badges shown while collapsed. */
  maxVisible?: number;
}

/**
 * Compact shelf of earned badges, expandable to the full list. Stats come from
 * the game store through `usePlayerStats` — there is no prop chain and no
 * second stats store. Every style is a shared token.
 */
export function BadgeShelf({ title = 'Badges', maxVisible = DEFAULT_MAX_VISIBLE }: BadgeShelfProps = {}) {
  const [expanded, setExpanded] = useState(false);
  const stats = usePlayerStats();
  const unlocked = getUnlockedBadges(stats);
  const locked = getLockedBadges(stats);
  const shown = expanded ? [...unlocked, ...locked] : unlocked.slice(0, maxVisible);
  const earnedIds = new Set(unlocked.map((b) => b.id));

  const chip = (b: BadgeDef) => (
    <span
      key={b.id}
      title={b.description}
      className={classes(CHROME.badge, 'border inline-flex items-center', earnedIds.has(b.id) ? RARITY[b.rarity] : COLOR.muted)}
    >
      {b.name}
    </span>
  );

  return (
    <section className={classes(CHROME.tile, PADDING[3], 'flex flex-col', GAP[2])}>
      <div className={classes('flex items-center justify-between', GAP[2])}>
        <h3 className={classes(TYPE.body, WEIGHT.bold, COLOR.fg)}>
          {title}
          <span className={classes(TYPE.caption, COLOR.muted, 'ml-2')}>
            {unlocked.length}/{BADGES.length}
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={classes(CHROME.iconButton, TYPE.caption)}
          aria-label={expanded ? 'Collapse badges' : 'Expand badges'}
        >
          {expanded ? 'Show fewer' : 'Show all'}
        </button>
      </div>

      {unlocked.length === 0 && !expanded ? (
        <p className={classes(TYPE.caption, COLOR.muted)}>No badges yet — keep clicking.</p>
      ) : (
        <div className={classes('flex flex-wrap', GAP[1])}>{shown.map(chip)}</div>
      )}

      {!expanded && locked.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={classes(TYPE.caption, COLOR.muted, COLOR.hoverFg, 'cursor-pointer text-left')}
        >
          {locked.length} locked
        </button>
      )}
    </section>
  );
}
