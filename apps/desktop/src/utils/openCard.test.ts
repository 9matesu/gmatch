// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { canonicalCardId, openCardDetail, OPEN_CARD_EVENT } from './openCard'

describe('openCard', () => {
  it('prefers the canonical card_id over the media id', () => {
    expect(canonicalCardId({ id: 'media-1', card_id: 'card-9' })).toBe('card-9')
    expect(canonicalCardId({ id: 'media-1' })).toBe('media-1')
  })

  it('dispatches gmatch:open-card with the resolved id', () => {
    const handler = vi.fn()
    window.addEventListener(OPEN_CARD_EVENT, handler)
    openCardDetail({ id: 'media-1', card_id: 'card-9' })
    window.removeEventListener(OPEN_CARD_EVENT, handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ cardId: 'card-9' })
  })
})
