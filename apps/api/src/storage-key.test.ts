import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveStorageKey, generateHexKey } from './storage-key'

const ZERO_KEY = '00'.repeat(32)

describe('resolveStorageKey', () => {
  it('honors a valid env key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk-'))
    const key = 'ab'.repeat(32)
    expect(resolveStorageKey(join(dir, 'orbit.sqlite'), { STORAGE_ENCRYPTION_KEY: key })).toBe(key)
    expect(existsSync(join(dir, 'storage.key'))).toBe(false)
  })

  it('rejects the zero key and missing key, generating a persisted one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk-'))
    for (const bad of [undefined, '', ZERO_KEY, 'nothex'.repeat(10)]) {
      const d = mkdtempSync(join(tmpdir(), 'gk-'))
      const key = resolveStorageKey(join(d, 'orbit.sqlite'), { STORAGE_ENCRYPTION_KEY: bad })
      expect(key).toMatch(/^[0-9a-f]{64}$/)
      expect(key).not.toBe(ZERO_KEY)
      expect(readFileSync(join(d, 'storage.key'), 'utf8').trim()).toBe(key)
    }
    void dir
  })

  it('reuses the persisted key across boots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk-'))
    const first = resolveStorageKey(join(dir, 'orbit.sqlite'), {})
    const second = resolveStorageKey(join(dir, 'orbit.sqlite'), {})
    expect(second).toBe(first)
  })

  it('env key wins over a persisted one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk-'))
    resolveStorageKey(join(dir, 'orbit.sqlite'), {})
    const key = 'cd'.repeat(32)
    expect(resolveStorageKey(join(dir, 'orbit.sqlite'), { STORAGE_ENCRYPTION_KEY: key })).toBe(key)
  })

  it('generateHexKey returns 64 hex chars', () => {
    expect(generateHexKey()).toMatch(/^[0-9a-f]{64}$/)
  })
})
