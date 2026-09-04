import { describe, it, expect } from 'vitest'
import { canUseBots, botFallbackWaitMs, resolveActivationRule } from './policy'
import type { BotConfig } from '@orbit/shared'

function config(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    providers: [],
    names: ['Aria'],
    enabled: true,
    ...overrides,
  }
}

describe('bot policy', () => {
  it('resolves the effective activation rule from enabled flag', () => {
    expect(resolveActivationRule(config({ activationRule: 'fallback' }))).toBe('fallback')
    expect(resolveActivationRule(config({ enabled: true }))).toBe('fallback')
    expect(resolveActivationRule(config({ enabled: false }))).toBe('disabled')
  })

  it('disabled bots are never allowed', () => {
    const cfg = config({ enabled: true, activationRule: 'disabled' })
    expect(canUseBots(cfg, 'quick_match').allowed).toBe(false)
    expect(canUseBots(cfg, 'queue_fallback').allowed).toBe(false)
    expect(canUseBots(cfg, 'manual').allowed).toBe(false)
  })

  it('enabled=false forbids bots regardless of rule', () => {
    const cfg = config({ enabled: false, activationRule: 'immediate' })
    expect(canUseBots(cfg, 'quick_match').allowed).toBe(false)
  })

  it('manual_only allows manual context only', () => {
    const cfg = config({ activationRule: 'manual_only' })
    expect(canUseBots(cfg, 'manual').allowed).toBe(true)
    expect(canUseBots(cfg, 'quick_match').allowed).toBe(false)
    expect(canUseBots(cfg, 'queue_fallback').allowed).toBe(false)
  })

  it('immediate and fallback allow all automated contexts', () => {
    for (const rule of ['immediate', 'fallback'] as const) {
      const cfg = config({ activationRule: rule })
      expect(canUseBots(cfg, 'quick_match').allowed).toBe(true)
      expect(canUseBots(cfg, 'queue_fallback').allowed).toBe(true)
      expect(canUseBots(cfg, 'manual').allowed).toBe(true)
    }
  })

  it('botFallbackWaitMs is zero for immediate and uses fallbackSeconds otherwise', () => {
    expect(botFallbackWaitMs(config({ activationRule: 'immediate', fallbackSeconds: 999 }))).toBe(0)
    expect(botFallbackWaitMs(config({ activationRule: 'fallback', fallbackSeconds: 120 }))).toBe(120_000)
    expect(botFallbackWaitMs(config({ activationRule: 'fallback' }))).toBe(120_000)
    expect(botFallbackWaitMs(config({ activationRule: 'fallback', fallbackSeconds: 0 }))).toBe(0)
  })
})
