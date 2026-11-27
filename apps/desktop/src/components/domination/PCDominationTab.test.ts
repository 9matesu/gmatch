import { describe, it, expect } from 'vitest'
import { INTENSITY_PRESETS, DOMINATION_SUBTABS } from './PCDominationTab'
import {
  DOM_ACTION_CONSENT,
  decodeDomBody,
  encodeDomRequest,
  validateDomPayload,
  newDomId,
} from '../../utils/dominationMesh'

describe('PCDominationTab constants', () => {
  it('defines valid subtabs for category navigation', () => {
    expect(DOMINATION_SUBTABS).toEqual(['send', 'consent', 'history', 'hacks'])
  })

  it('defines valid intensity presets with expected consent keys', () => {
    expect(INTENSITY_PRESETS.mild).toBeDefined()
    expect(INTENSITY_PRESETS.medium).toBeDefined()
    expect(INTENSITY_PRESETS.extreme).toBeDefined()

    expect(INTENSITY_PRESETS.mild.allowRemoteCamera).toBe(false)
    expect(INTENSITY_PRESETS.extreme.allowRemoteCamera).toBe(true)
    expect(INTENSITY_PRESETS.extreme.allowDesktopBackgroundChange).toBe(true)
  })

  it('contains expected granular control map entries', () => {
    for (const preset of ['mild', 'medium', 'extreme'] as const) {
      expect(typeof INTENSITY_PRESETS[preset].allowBlurEverything).toBe('boolean')
      expect(typeof INTENSITY_PRESETS[preset].allowPopupVideo).toBe('boolean')
      expect(typeof INTENSITY_PRESETS[preset].allowPopupMessage).toBe('boolean')
      expect(typeof INTENSITY_PRESETS[preset].allowTextOverlay).toBe('boolean')
    }
  })
})

/**
 * Every server lane action (the API debits the authoritative ledger, pays the
 * consent cut and broadcasts before the receiver renders it) has a matching
 * client contract: a consent key, a validated payload and a stable wire id.
 * The mesh lane is free and carries the same id as its idempotency key.
 */
describe('domination action contract (all seven effects)', () => {
  const cases: Record<string, unknown> = {
    wallpaper: { url: 'https://example.com/a.jpg' },
    game_bg: { url: 'https://example.com/b.jpg' },
    popup_video: { url: 'https://example.com/c.mp4' },
    message: { text: 'hi' },
    text_overlay: { text: 'hi', position: 'top' },
    blur: { intensity: 8 },
    camera: { quality: 0.8 },
  }

  it('is consent-gated, payload-validated and idempotent for every action', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(DOM_ACTION_CONSENT).sort())
    for (const [action, raw] of Object.entries(cases)) {
      expect(DOM_ACTION_CONSENT[action]).toMatch(/^allow[A-Z]/)
      const checked = validateDomPayload(action, raw)
      expect(checked.ok, `${action} payload`).toBe(true)

      const id = newDomId()
      const sent = encodeDomRequest({ id, action, payload: checked.ok ? checked.payload : undefined })
      const received = decodeDomBody(sent)
      expect(received?.t, `${action} wire kind`).toBe('dom_request')
      expect((received as { id?: string }).id, `${action} idempotency key`).toBe(id)

      // A retry resends the SAME id, so the receiver executes at most once.
      const retry = decodeDomBody(encodeDomRequest({ id, action, payload: checked.ok ? checked.payload : undefined }))
      expect((retry as { id?: string }).id).toBe(id)
    }
  })
})
