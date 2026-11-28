// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BlocklistSection } from './BlocklistSection'
import {
  isTagBlocked,
  __resetBlocklist,
  updateActiveBlocklist,
} from '../../game/tagFilter'

describe('BlocklistSection', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
    } as Storage)
    __resetBlocklist()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the compact blocklist header and mode toggle', () => {
    render(<BlocklistSection />)
    expect(screen.getByText('Content Blocklist')).toBeInTheDocument()
    expect(screen.getByText('Changes save automatically')).toBeInTheDocument()
    expect(screen.getByText('Visual Lists')).toBeInTheDocument()
    expect(screen.getByText('Raw JSON')).toBeInTheDocument()
    expect(screen.getByText('Blocklist', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument()
  })

  it('keeps the tag search and add fields compact single-line inputs', () => {
    render(<BlocklistSection />)
    const add = screen.getByPlaceholderText(/Add tag\(s\) to blocklist/i)
    const search = screen.getByPlaceholderText(/Search \d+ tags/i)
    for (const input of [add, search]) {
      expect(input.tagName).toBe('INPUT')
      expect(input.className).toContain('py-1.5')
      expect(input.className).toContain('text-xs')
      expect(input.className).not.toMatch(/\bpy-(2|2\.5|3)\b/)
    }
  })

  it('allows switching to raw JSON mode and back to visual mode', () => {
    render(<BlocklistSection />)
    const jsonBtn = screen.getByText('Raw JSON')
    fireEvent.click(jsonBtn)

    expect(screen.getByText('shared/blocklist.json')).toBeInTheDocument()
    expect(screen.getByText('Valid JSON')).toBeInTheDocument()

    const visualBtn = screen.getByText('Visual Lists')
    fireEvent.click(visualBtn)
    expect(screen.getByText('Blocklist', { exact: true })).toBeInTheDocument()
  })

  it('autosaves a new tag in visual mode — no Save button needed', async () => {
    const toast = vi.fn()
    render(<BlocklistSection toast={toast} />)

    const input = screen.getByPlaceholderText(/Add tag\(s\) to blocklist\.\.\./i)
    fireEvent.change(input, { target: { value: 'custom_prohibited_term' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/i }))

    expect(screen.getByText('custom_prohibited_term')).toBeInTheDocument()
    await waitFor(() => expect(isTagBlocked('custom_prohibited_term')).toBe(true))
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Added 1 tag'), 'success')
  })

  it('opening the panel does NOT write the list back', async () => {
    // The panel used to auto-save on MOUNT, which wrote the renderer's
    // in-memory copy over the file — silently reverting a ban made in the
    // clicker ("I banned yaoi and it came back").
    const blocklistSet = vi.fn(async () => ({ ok: true }))
    const blocklistGet = vi.fn(async () => ({
      current: { blocklist: ['loli', 'yaoi'], suggested: [], noise: [] },
      defaults: { blocklist: [], suggested: [], noise: [] },
    }))
    ;(window as unknown as { gmatch: unknown }).gmatch = { blocklistGet, blocklistSet }

    try {
      render(<BlocklistSection />)
      await waitFor(() => expect(blocklistGet).toHaveBeenCalled())
      // The panel loaded the CURRENT list (the ban is in it) and wrote NOTHING.
      expect(blocklistSet).not.toHaveBeenCalled()
    } finally {
      delete (window as unknown as { gmatch?: unknown }).gmatch
    }
  })

  it('autosaves a tag removal in visual mode', async () => {
    render(<BlocklistSection />)

    expect(isTagBlocked('shota')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Remove shota/i }))

    expect(screen.queryByText('shota')).not.toBeInTheDocument()
    await waitFor(() => expect(isTagBlocked('shota')).toBe(false))
  })

  it('reports invalid JSON and writes nothing', async () => {
    const blocklistSet = vi.fn(async () => ({ ok: true }))
    ;(window as unknown as { gmatch: unknown }).gmatch = { blocklistSet }
    try {
      render(<BlocklistSection />)

      fireEvent.click(screen.getByText('Raw JSON'))
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: '{ "blocklist": [ invalid json }' },
      })

      expect(screen.getByText(/not valid JSON/i)).toBeInTheDocument()
      await waitFor(() => expect(blocklistSet).not.toHaveBeenCalled())
      expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument()
    } finally {
      delete (window as unknown as { gmatch?: unknown }).gmatch
    }
  })

  it('allows resetting blocklist to factory defaults', async () => {
    // Modify active blocklist first
    updateActiveBlocklist({ blocklist: ['only_one_term'] })
    expect(isTagBlocked('loli')).toBe(false)
    expect(isTagBlocked('only_one_term')).toBe(true)

    // Confirm dialog mock
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const toast = vi.fn()
    render(<BlocklistSection toast={toast} />)

    const resetBtn = screen.getByRole('button', { name: /Reset to Defaults/i })
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(isTagBlocked('loli')).toBe(true)
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('restored to defaults'),
        'success',
      )
    })
  })
})
