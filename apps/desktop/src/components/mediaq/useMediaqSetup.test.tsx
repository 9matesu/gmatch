// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useMediaqSetup } from './useMediaqSetup'
import { useMediaqInstall } from '../../services/mediaqInstall'

function Harness() {
  useMediaqSetup()
  return null
}

describe('useMediaqSetup', () => {
  const mediaqStatus = vi.fn(async () => ({ installed: false, running: false, base: 'x' }))

  beforeEach(() => {
    mediaqStatus.mockClear()
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => void mem.set(key, String(value)),
      removeItem: (key: string) => void mem.delete(key),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size },
    } as Storage)
    ;(window as unknown as { gmatch: { mediaqStatus: typeof mediaqStatus } }).gmatch = {
      mediaqStatus,
    }
    useMediaqInstall.setState({ open: false, status: 'idle', percent: null, message: '' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('never opens the installer on startup, even when mediaq is missing', () => {
    render(<Harness />)
    expect(mediaqStatus).not.toHaveBeenCalled()
    expect(useMediaqInstall.getState().open).toBe(false)
  })

  it('keeps the installer reachable later through the shared store', () => {
    render(<Harness />)
    useMediaqInstall.getState().openModal()
    expect(useMediaqInstall.getState().open).toBe(true)
  })
})
