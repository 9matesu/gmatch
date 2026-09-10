import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_ORDER,
  SIDEBAR_ORDER_KEY,
  readSidebarOrder,
  reconcileSidebarOrder,
  reorderSidebarIds,
  writeSidebarOrder,
} from './sidebarOrder'

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

describe('sidebarOrder', () => {
  it('defaults to the canonical order when nothing is stored', () => {
    expect(readSidebarOrder(memStorage())).toEqual([...DEFAULT_SIDEBAR_ORDER])
  })

  it('reads a valid stored order and ignores malformed data', () => {
    const ok = memStorage({ [SIDEBAR_ORDER_KEY]: JSON.stringify(['games', 'feed']) })
    expect(readSidebarOrder(ok)).toEqual(['games', 'feed'])
    const bad = memStorage({ [SIDEBAR_ORDER_KEY]: '{not json' })
    expect(readSidebarOrder(bad)).toEqual([...DEFAULT_SIDEBAR_ORDER])
    const wrong = memStorage({ [SIDEBAR_ORDER_KEY]: JSON.stringify([1, 2, 3]) })
    expect(readSidebarOrder(wrong)).toEqual([...DEFAULT_SIDEBAR_ORDER])
  })

  it('persists order', () => {
    const s = memStorage()
    writeSidebarOrder(['feed', 'games'], s)
    expect(readSidebarOrder(s)).toEqual(['feed', 'games'])
  })

  it('moves the dragged id just before the target id', () => {
    const order = ['feed', 'games', 'messages', 'servers']
    expect(reorderSidebarIds(order, 'servers', 'games')).toEqual([
      'feed',
      'servers',
      'games',
      'messages',
    ])
  })

  it('is a no-op for equal, missing, or unknown ids', () => {
    const order = ['feed', 'games', 'messages']
    expect(reorderSidebarIds(order, 'feed', 'feed')).toEqual(order)
    expect(reorderSidebarIds(order, 'ghost', 'games')).toEqual(order)
    expect(reorderSidebarIds(order, 'games', 'ghost')).toEqual(order)
  })

  it('does not mutate its input array', () => {
    const order = ['feed', 'games', 'messages']
    reorderSidebarIds(order, 'messages', 'feed')
    expect(order).toEqual(['feed', 'games', 'messages'])
  })

  it('reconciles to only visible ids, preserving saved order', () => {
    const saved = ['games', 'settings', 'feed', 'messages']
    const visible = ['feed', 'games', 'messages']
    expect(reconcileSidebarOrder(saved, visible)).toEqual(['games', 'feed', 'messages'])
  })

  it('slots newly-visible known ids at their default position', () => {
    // saved order predates the 'rooms' entry becoming visible
    const saved = ['feed', 'games', 'messages', 'servers']
    const visible = ['feed', 'games', 'messages', 'rooms', 'servers']
    // rooms has no saved rank; among ranked items it sorts last
    const out = reconcileSidebarOrder(saved, visible)
    expect(out).toContain('rooms')
    expect(new Set(out).size).toBe(visible.length)
    expect(out.filter((x) => x !== 'rooms')).toEqual(['feed', 'games', 'messages', 'servers'])
  })

  it('keeps every visible id exactly once', () => {
    const out = reconcileSidebarOrder(['games'], ['feed', 'games', 'rooms'])
    expect(out.sort()).toEqual(['feed', 'games', 'rooms'])
  })
})
