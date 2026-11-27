"use client";

import { Sparkles, Clock } from 'lucide-react'
import {
  classes, CHROME, COLOR, GAP, ICON, MOTION, PADDING_X, RADIUS, SHADOW,
  STATUS, TRACKING, TYPE, WEIGHT,
} from '../ui/tokens'

interface CardBackProps {
  label?: string
  className?: string
  ticking?: boolean
}

/**
 * Premium card-back used wherever an opponent (or spectator) card is hidden or
 * being picked. It shares the shell's surface and status roles with every other
 * card screen; the only game semantics are the clock and the ticking pulse.
 */
export function CardBack({ label, className = '', ticking = false }: CardBackProps) {
  const isTicking = ticking || (label && (label.toLowerCase().includes('picking') || label.toLowerCase().includes('choosing') || label.toLowerCase().includes('waiting')))

  return (
    <div className={classes(
      'relative w-full h-full flex flex-col items-center justify-center', GAP[2],
      'overflow-hidden bg-surface-canvas select-none', className,
    )}>
      {/* Quiet inset frame — one plate, one hairline, no decorative gradients. */}
      <div className={classes('absolute inset-1.5 border-2 pointer-events-none', RADIUS.panel, MOTION.transition.micro, isTicking ? classes(COLOR.accentEdge, 'animate-orbit-pulse-soft') : COLOR.edge)} />
      <div className={classes('absolute inset-3 border pointer-events-none', RADIUS.control, COLOR.edgeSubtle)} />

      {isTicking && (
        <div className={classes('absolute inset-0 pointer-events-none', COLOR.glassW5, 'animate-orbit-pulse-soft')} />
      )}

      {/* Center icon and label */}
      <div className={classes('relative flex flex-col items-center justify-center', GAP[1.5], 'z-10')}>
        <div className={classes(
          'size-10 rounded-xl border flex items-center justify-center', RADIUS.panel, SHADOW.sm,
          MOTION.transition.micro, isTicking ? classes(COLOR.accentEdge, STATUS.info) : COLOR.muted,
        )}>
          {isTicking ? <Clock className={classes(ICON.lg, 'animate-spin')} style={{ animationDuration: '4s' }} /> : <Sparkles className={ICON.lg} />}
        </div>

        {label && (
          <span className={classes(
            TYPE.caption, WEIGHT.semibold, TRACKING.wide, 'uppercase text-center', PADDING_X[2], 'py-0.5', RADIUS.chip,
            isTicking ? classes(COLOR.accentBg, COLOR.onAccent) : classes(CHROME.badge, COLOR.muted),
          )}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
