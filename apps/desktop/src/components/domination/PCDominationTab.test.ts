import { describe, it, expect } from 'vitest'
import { INTENSITY_PRESETS } from './PCDominationTab'

describe('PCDominationTab constants', () => {
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
