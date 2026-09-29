// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { UsersTab } from './UsersTab'
import { adminApi } from '../../../utils/adminApi'

/**
 * The E2E purge is a destructive bulk operation reached from the admin panel.
 * Two things must hold: it is a dry run until a preview has been seen, and the
 * confirmed count is the count that gets deleted.
 */

const identity = { orbitId: 'me', publicKeyHex: 'pub', privateKeyHex: 'priv' } as never

vi.mock('../../../utils/adminApi', () => ({
  adminApi: {
    users: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    cards: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    market: vi.fn().mockResolvedValue({ data: [] }),
    decks: vi.fn().mockResolvedValue({ data: [] }),
    wallets: vi.fn().mockResolvedValue({ data: [] }),
    ledger: vi.fn().mockResolvedValue({ data: [] }),
    purgeE2e: vi.fn(),
  },
}))

const purgeMock = vi.mocked(adminApi.purgeE2e)

function renderTab() {
  return render(
    <UsersTab
      identity={identity}
      pinVerified
      onZoom={vi.fn()}
      onAction={vi.fn()}
    />,
  )
}

/** Open the Test Cleanup subtab. */
async function openCleanup() {
  renderTab()
  fireEvent.click(await screen.findByText('Test Cleanup'))
}

describe('admin E2E purge panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    purgeMock.mockReset()
    purgeMock.mockResolvedValue({ dryRun: true, matched: 0, wouldDelete: 0, tag: 'e2e', sample: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has no delete button until a preview has been run', async () => {
    await openCleanup()
    expect(screen.getByRole('button', { name: /^Preview$/i })).toBeTruthy()
    // The destructive action is not on the page at all yet.
    expect(screen.queryByRole('button', { name: /Delete \d+ account/i })).toBeNull()
  })

  it('previews before deleting, and never calls the server with dryRun:false implicitly', async () => {
    purgeMock.mockResolvedValue({
      dryRun: true,
      matched: 3,
      wouldDelete: 3,
      tag: 'e2e',
      sample: [{ id: 'a'.repeat(64), display_name: 'E2E Tester', last_seen: null }],
    })
    await openCleanup()
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))

    await waitFor(() => expect(purgeMock).toHaveBeenCalledTimes(1))
    expect(purgeMock.mock.calls[0][1]).toEqual({ dryRun: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete 3 account/i })).toBeTruthy())
  })

  it('deletes only after an explicit confirm', async () => {
    purgeMock.mockResolvedValue({
      dryRun: true, matched: 2, wouldDelete: 2, tag: 'e2e', sample: [],
    })
    purgeMock.mockResolvedValueOnce({
      dryRun: true, matched: 2, wouldDelete: 2, tag: 'e2e', sample: [],
    })
    purgeMock.mockResolvedValueOnce({ success: true, dryRun: false, matched: 2, deleted: 2, errors: [] })

    await openCleanup()
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete 2 account/i })).toBeTruthy())

    // Declining the confirm does nothing.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: /Delete 2 account/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(purgeMock).toHaveBeenCalledTimes(1)

    // Confirming deletes.
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Delete 2 account/i }))
    await waitFor(() => expect(purgeMock).toHaveBeenCalledTimes(2))
    expect(purgeMock.mock.calls[1][1]).toEqual({ dryRun: false })
    await waitFor(() => expect(screen.getByText(/Deleted 2 of 2/)).toBeTruthy())
  })

  it('sends the previewed batch size with the delete so the count matches', async () => {
    purgeMock.mockResolvedValueOnce({
      dryRun: true, matched: 500, wouldDelete: 50, tag: 'e2e', sample: [],
    })
    purgeMock.mockResolvedValueOnce({ success: true, dryRun: false, matched: 500, deleted: 50, errors: [] })

    await openCleanup()
    fireEvent.change(screen.getByPlaceholderText('all'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete 50 account/i })).toBeTruthy())
    expect(purgeMock.mock.calls[0][1]).toEqual({ dryRun: true, limit: 50 })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Delete 50 account/i }))
    await waitFor(() => expect(purgeMock).toHaveBeenCalledTimes(2))
    // Partial batch: the limit must travel with the delete, or all 500 go.
    expect(purgeMock.mock.calls[1][1]).toEqual({ dryRun: false, limit: 50 })
  })

  it('reports a failure without claiming success', async () => {
    purgeMock.mockResolvedValueOnce({
      dryRun: true, matched: 1, wouldDelete: 1, tag: 'e2e', sample: [],
    })
    purgeMock.mockResolvedValueOnce({
      success: true, dryRun: false, matched: 1, deleted: 0, errors: [{ id: 'x', error: 'locked' }],
    })
    await openCleanup()
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete 1 account/i })).toBeTruthy())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Delete 1 account/i }))
    await waitFor(() => expect(screen.getByText(/Deleted 0 of 1 account\(s\), 1 failed/)).toBeTruthy())
  })
})
