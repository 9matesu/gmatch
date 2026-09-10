// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizablePanel, PANEL_LIMITS } from './useResizablePanel'

function localStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', localStore())
})

describe('useResizablePanel (UI-3/UI-4)', () => {
  it('starts at the stored width, else default', () => {
    const { result } = renderHook(() => useResizablePanel('chat'))
    expect(result.current.width).toBe(PANEL_LIMITS.chat.default)
  })

  it('resizeTo clamps to min/max of the named panel', () => {
    const { result } = renderHook(() => useResizablePanel('chat'))
    act(() => result.current.resizeTo(10_000))
    expect(result.current.width).toBe(PANEL_LIMITS.chat.max)
    act(() => result.current.resizeTo(0))
    expect(result.current.width).toBe(PANEL_LIMITS.chat.min)
    act(() => result.current.resizeTo(480))
    expect(result.current.width).toBe(480)
  })

  it('persists per panel id and restores across instances', () => {
    const { result } = renderHook(() => useResizablePanel('chat'))
    act(() => result.current.resizeTo(700))
    const { result: second } = renderHook(() => useResizablePanel('chat'))
    expect(second.current.width).toBe(700)
    // a different panel id has its own width
    const { result: dock } = renderHook(() => useResizablePanel('dock'))
    expect(dock.current.width).toBe(PANEL_LIMITS.dock.default)
  })

  it('dragBy accumulates deltas in the live width and clamps at the edges', () => {
    const { result } = renderHook(() => useResizablePanel('dock'))
    const start = result.current.width
    act(() => result.current.dragBy(120)) // right-docked? caller signed; just accumulate
    expect(result.current.width).toBe(start + 120)
    act(() => result.current.dragBy(-100_000))
    expect(result.current.width).toBe(PANEL_LIMITS.dock.min)
  })

  it('reset restores the default width (and persists it)', () => {
    const { result } = renderHook(() => useResizablePanel('chat'))
    act(() => result.current.resizeTo(777))
    act(() => result.current.reset())
    expect(result.current.width).toBe(PANEL_LIMITS.chat.default)
  })
})
