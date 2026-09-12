// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandIsland } from './CommandIsland'

// The sidebar/footer chrome was replaced by the island; these tests pin that
// every view keeps an entry point (regression: pc_domination + rooms went
// unreachable in the HUD wave).
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }))
})

const openMore = () => {
  fireEvent.click(screen.getByRole('button', { name: 'More options' }))
}

describe('CommandIsland navigation coverage', () => {
  it('More menu reaches Domination (was orphaned with the sidebar)', async () => {
    const setMainView = vi.fn()
    render(<CommandIsland mainView="feed" setMainView={setMainView} />)
    openMore()
    fireEvent.click(await screen.findByText('Domination'))
    expect(setMainView).toHaveBeenCalledWith('pc_domination')
  })

  it('Rooms entry appears only for active couriers', async () => {
    const setMainView = vi.fn()
    const { unmount } = render(<CommandIsland mainView="feed" setMainView={setMainView} />)
    openMore()
    expect(await screen.findByText('Domination')).toBeInTheDocument()
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument()
    unmount()
    render(<CommandIsland mainView="feed" setMainView={setMainView} showRooms />)
    openMore()
    fireEvent.click(await screen.findByText('Rooms'))
    expect(setMainView).toHaveBeenCalledWith('rooms')
  })
})
