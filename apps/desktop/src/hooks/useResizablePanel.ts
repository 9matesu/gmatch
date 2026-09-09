import { useCallback, useRef, useState } from 'react'

/**
 * Shared resizable-panel state (UI-3/UI-4): width per named panel, clamped
 * to sane limits (never covers the main content), persisted in localStorage
 * so the choice survives navigation and restarts. The chat sidebar uses it
 * today; any other panel/popup reuses the same hook + the <PanelResizer>
 * handle. Pointer math lives in the handle component; this is state + clamp.
 */
export const PANEL_LIMITS = {
  chat: { min: 280, max: 900, default: 672 },
  dock: { min: 240, max: 720, default: 420 },
} as const

export type PanelId = keyof typeof PANEL_LIMITS

const STORE_KEY = (id: PanelId) => `gmatch.panel.width.${id}`

export function clampPanelWidth(id: PanelId, w: number): number {
  const { min, max } = PANEL_LIMITS[id]
  if (!Number.isFinite(w)) return PANEL_LIMITS[id].default
  return Math.round(Math.min(max, Math.max(min, w)))
}

export function readPanelWidth(id: PanelId): number {
  try {
    const raw = localStorage.getItem(STORE_KEY(id))
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) return clampPanelWidth(id, n)
    }
  } catch {
    /* private mode */
  }
  return PANEL_LIMITS[id].default
}

export function useResizablePanel(id: PanelId) {
  const [width, setWidth] = useState<number>(() => readPanelWidth(id))
  const widthRef = useRef(width)
  widthRef.current = width

  const resizeTo = useCallback(
    (w: number) => {
      const next = clampPanelWidth(id, w)
      widthRef.current = next
      setWidth(next)
      try {
        localStorage.setItem(STORE_KEY(id), String(next))
      } catch {
        /* session-only */
      }
    },
    [id],
  )

  /** Drag input: screen-x delta (sign already applied by the handle). */
  const dragBy = useCallback(
    (dPx: number) => resizeTo(widthRef.current + dPx),
    [resizeTo],
  )

  const reset = useCallback(
    () => resizeTo(PANEL_LIMITS[id].default),
    [id, resizeTo],
  )

  return { width, resizeTo, dragBy, reset, limits: PANEL_LIMITS[id] }
}
