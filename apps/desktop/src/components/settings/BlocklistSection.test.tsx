// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BlocklistSection } from './BlocklistSection'
import {
  isTagBlocked,
  isNoise,
  saveBlocklist,
  resetBlocklist,
  __resetBlocklist,
  getActiveBlocklistData,
  updateActiveBlocklist,
  DEFAULT_BLOCKLIST_DATA,
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

  it('renders the blocklist configuration header and mode toggle', () => {
    render(<BlocklistSection />)
    expect(screen.getByText(/Content Blocklist \(blocklist\.json\)/i)).toBeInTheDocument()
    expect(screen.getByText('Visual Lists')).toBeInTheDocument()
    expect(screen.getByText('Raw JSON')).toBeInTheDocument()
    expect(screen.getByText('Hard Blocklist (blocklist)')).toBeInTheDocument()
  })

  it('allows switching to raw JSON mode and back to visual mode', () => {
    render(<BlocklistSection />)
    const jsonBtn = screen.getByText('Raw JSON')
    fireEvent.click(jsonBtn)

    expect(screen.getByText('shared/blocklist.json')).toBeInTheDocument()
    expect(screen.getByText('Valid JSON')).toBeInTheDocument()

    const visualBtn = screen.getByText('Visual Lists')
    fireEvent.click(visualBtn)
    expect(screen.getByText('Hard Blocklist (blocklist)')).toBeInTheDocument()
  })

  it('allows adding a new tag in visual mode and saving', async () => {
    const toast = vi.fn()
    render(<BlocklistSection toast={toast} />)

    // Add a custom tag 'custom_prohibited_term'
    const input = screen.getByPlaceholderText(/Add tag\(s\) to blocklist\.\.\./i)
    fireEvent.change(input, { target: { value: 'custom_prohibited_term' } })
    const addBtn = screen.getByRole('button', { name: /Add/i })
    fireEvent.click(addBtn)

    expect(screen.getByText('custom_prohibited_term')).toBeInTheDocument()

    // Save changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(isTagBlocked('custom_prohibited_term')).toBe(true)
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('saved and applied'),
        'success',
      )
    })
  })

  it('allows removing a tag in visual mode and saving', async () => {
    const toast = vi.fn()
    render(<BlocklistSection toast={toast} />)

    // Verify 'shota' is currently in blocklist
    expect(isTagBlocked('shota')).toBe(true)
    const removeBtn = screen.getByRole('button', { name: /Remove shota/i })
    fireEvent.click(removeBtn)

    expect(screen.queryByText('shota')).not.toBeInTheDocument()

    // Save changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      // shota should no longer be blocked because it was removed from the blocklist!
      expect(isTagBlocked('shota')).toBe(false)
    })
  })

  it('detects invalid JSON syntax in raw JSON mode and blocks saving', async () => {
    const toast = vi.fn()
    render(<BlocklistSection toast={toast} />)

    fireEvent.click(screen.getByText('Raw JSON'))
    const textarea = screen.getByRole('textbox')

    // Corrupt JSON
    fireEvent.change(textarea, { target: { value: '{ "blocklist": [ invalid json }' } })

    expect(screen.getByText(/not valid JSON/i)).toBeInTheDocument()
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
    expect(saveBtn).toBeDisabled()
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
