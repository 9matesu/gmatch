// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IdleOverlay } from './IdleOverlay'
import { orbitFetch } from '../utils/api'
import { playChime } from '../utils/sounds'

vi.mock('../utils/api', () => ({ orbitFetch: vi.fn() }))
vi.mock('../utils/sounds', () => ({ playChime: vi.fn() }))

const item = (id: string) =>
  ({ id, mime_type: 'image/jpeg', content_hash: `sha256:${id}` }) as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:keepsake'),
    revokeObjectURL: vi.fn(),
  })
  vi.mocked(orbitFetch).mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }),
  } as never)
})

describe('IdleOverlay copy and exit', () => {
  it('names the real loading operation and exits once on tap', async () => {
    const onExit = vi.fn()
    const { container } = render(<IdleOverlay items={[item('a')]} identity={{} as never} onExit={onExit} />)

    // Honest state: it is resolving the keepsakes' bytes, not a generic spinner.
    expect(screen.getByText(/Loading your keepsakes/)).toBeTruthy()
    expect(screen.getByText(/Tap anywhere or press any key to return/)).toBeTruthy()

    await waitFor(() => expect(container.querySelector('img')).toBeTruthy())
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(playChime).toHaveBeenCalledTimes(1)
  })

  it('distinguishes an empty keepsake shelf from a failed load', () => {
    render(<IdleOverlay items={[]} identity={{} as never} onExit={vi.fn()} />)
    expect(screen.getByText(/No keepsakes saved yet/)).toBeTruthy()
    expect(orbitFetch).not.toHaveBeenCalled()
  })
})
