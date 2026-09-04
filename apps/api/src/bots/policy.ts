import type { BotConfig } from '@orbit/shared'

/**
 * The context a bot is being requested from. The same activation rule can
 * behave differently per context, e.g. `manual_only` forbids Quick Match but
 * allows an admin to force a bot duel.
 */
export type BotContext = 'quick_match' | 'queue_fallback' | 'manual'

export interface BotPolicyDecision {
  allowed: boolean
  reason?: string
}

export function resolveActivationRule(config: BotConfig): string {
  return config.activationRule ?? (config.enabled ? 'fallback' : 'disabled')
}

/**
 * Single source of truth for whether a bot may be used in a given context.
 * Consolidates the previously scattered/absent checks so the admin panel's
 * stated behavior matches the runtime.
 */
export function canUseBots(config: BotConfig, context: BotContext): BotPolicyDecision {
  if (!config.enabled) {
    return { allowed: false, reason: 'Bots are disabled.' }
  }

  const rule = resolveActivationRule(config)

  switch (rule) {
    case 'disabled':
      return { allowed: false, reason: 'Bot activation is set to disabled.' }
    case 'manual_only':
      if (context === 'manual') return { allowed: true }
      return { allowed: false, reason: 'Bots are manual-only. An admin must create the match.' }
    case 'immediate':
    case 'fallback':
      return { allowed: true }
    default:
      return { allowed: false, reason: `Unknown bot activation rule "${rule}".` }
  }
}

/**
 * How long a lone queued player must wait before an auto bot pairs with them.
 * `immediate` returns 0 (no wait); `fallback` uses the configured duration.
 */
export function botFallbackWaitMs(config: BotConfig): number {
  const rule = resolveActivationRule(config)
  if (rule === 'immediate') return 0
  const seconds =
    typeof config.fallbackSeconds === 'number' && Number.isFinite(config.fallbackSeconds)
      ? config.fallbackSeconds
      : 120
  return Math.max(0, Math.floor(seconds)) * 1000
}
