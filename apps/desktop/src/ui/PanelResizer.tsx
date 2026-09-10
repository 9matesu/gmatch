"use client";

import { useCallback, useRef } from 'react'

/**
 * Discreet vertical drag handle between a left-docked panel and the main
 * content (UI-3). Pointer-driven with capture (smooth, stable, works over
 * iframes), keyboard-accessible (arrows/Home), and inert while the panel is
 * collapsed. `onDelta(px)` receives screen-x movement: positive = wider.
 */
export function PanelResizer({
  onDelta,
  onResizeStart,
  onResizeEnd,
  side = 'right',
  disabled = false,
  label = 'Resize panel',
}: {
  onDelta: (px: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  /** 'right' = handle on the panel's RIGHT edge (left-docked panel); drag right grows. */
  side?: 'right' | 'left'
  disabled?: boolean
  label?: string
}) {
  const startX = useRef<number | null>(null)
  const sign = side === 'right' ? 1 : -1

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    startX.current = e.clientX
    onResizeStart?.()
    const move = (ev: PointerEvent) => {
      if (startX.current === null) return
      onDelta((ev.clientX - startX.current) * sign)
      startX.current = ev.clientX
    }
    const up = () => {
      startX.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onResizeEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [disabled, onDelta, onResizeStart, onResizeEnd, sign])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const step = e.shiftKey ? 32 : 8
      if (e.key === 'ArrowLeft') { onDelta(-step * sign); e.preventDefault() }
      else if (e.key === 'ArrowRight') { onDelta(step * sign); e.preventDefault() }
      else if (e.key === 'Home') { onResizeEnd?.(); e.preventDefault() }
    },
    [disabled, onDelta, onResizeEnd, sign],
  )

  if (disabled) return null
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="group shrink-0 w-1.5 -mx-[3px] z-30 cursor-col-resize relative touch-none outline-none focus-visible:bg-sky-400/60"
    >
      {/* invisible hit area + discreet grip line on hover/focus */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-transparent group-hover:bg-zinc-600 group-focus-visible:bg-sky-400 transition-colors" />
    </div>
  )
}
