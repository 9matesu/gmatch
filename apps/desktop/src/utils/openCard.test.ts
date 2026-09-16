// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { openCardDetail, OPEN_CARD_EVENT } from './openCard'

describe('openCard', () => {
  it('opens only for canonical cards: dispatches with card_id', () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_CARD_EVENT, handler)
    openCardDetail({ id: 'media-1', card_id: 'card-9' })
    window.removeEventListener(OPEN_CARD_EVENT, handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ cardId: 'card-9' })
  })

  it('does NOT open for legacy keepsakes with no canonical card (was: 404 on media id)', () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_CARD_EVENT, handler)
    openCardDetail({ id: '1ed9bc3a-b484-4536-b659-4873a4140b18' })
    window.removeEventListener(OPEN_CARD_EVENT, handler)
    expect(handler).not.toHaveBeenCalled()
  })
})
