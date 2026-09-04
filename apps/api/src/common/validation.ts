// Lightweight validation helpers used by domain services. No external schema
// library is a dependency; these cover the common shapes services need while
// keeping validation colocated with the layer that enforces it.

import { badRequest } from './errors'

export function requireString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`)
  const v = value.trim()
  if (opts.min !== undefined && v.length < opts.min) throw badRequest(`${field} must be at least ${opts.min} characters`)
  if (opts.max !== undefined && v.length > opts.max) throw badRequest(`${field} must be at most ${opts.max} characters`)
  return v
}

export function optionalString(value: unknown, field: string, opts: { max?: number } = {}): string | null {
  if (value === undefined || value === null) return null
  return requireString(value, field, opts)
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function requireInteger(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  // isSafeInteger (not isInteger) so values outside ±2^53 are rejected before
  // any lossy precision or SQLite binding.
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw badRequest(`${field} must be an integer`)
  }
  if (opts.min !== undefined && value < opts.min) throw badRequest(`${field} must be >= ${opts.min}`)
  if (opts.max !== undefined && value > opts.max) throw badRequest(`${field} must be <= ${opts.max}`)
  return value
}

export function requireNonNegativeInt(value: unknown, field: string, opts: { max?: number } = {}): number {
  return requireInteger(value, field, { min: 0, ...opts })
}

export function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
    throw badRequest(`${field} is not a valid id`)
  }
  return value
}

export function requireStringArray(value: unknown, field: string, opts: { maxItems?: number; maxLength?: number } = {}): string[] {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`)
  if (opts.maxItems !== undefined && value.length > opts.maxItems) {
    throw badRequest(`${field} must have at most ${opts.maxItems} items`)
  }
  return value.map((item, i) => requireString(item, `${field}[${i}]`, { max: opts.maxLength }))
}
