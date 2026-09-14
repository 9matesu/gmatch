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
  if (!screen.queryByText('Domination')) {
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
  }
}

describe('CommandIsland navigation coverage', () => {
  it('Profile button appears directly on the pill and navigates to profile', async () => {
    const setMainView = vi.fn()
    const onOpenProfile = vi.fn()
    render(<CommandIsland mainView="feed" setMainView={setMainView} onOpenProfile={onOpenProfile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(onOpenProfile).toHaveBeenCalled()
  })

  it('Satellite bar reaches Domination (was orphaned with the sidebar)', async () => {
    const setMainView = vi.fn()
    render(<CommandIsland mainView="feed" setMainView={setMainView} />)
    openMore()
    fireEvent.click(await screen.findByText('Domination'))
    expect(setMainView).toHaveBeenCalledWith('pc_domination')
  })

  it('Chat pill opens the unified rooms chat', async () => {
    const setMainView = vi.fn()
    render(<CommandIsland mainView="feed" setMainView={setMainView} />)
    fireEvent.click(screen.getByLabelText('Messages'))
    expect(setMainView).toHaveBeenCalledWith('messages')
  })

  it('toggles satellite bar visibility when clicking More options', async () => {
    const setMainView = vi.fn()
    render(<CommandIsland mainView="feed" setMainView={setMainView} />)
    expect(screen.getByText('Domination')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.queryByText('Domination')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByText('Domination')).toBeInTheDocument()
  })

  it('Clicker button appears on the pill and does not duplicate the notification button', async () => {
    const setMainView = vi.fn();
    render(<CommandIsland mainView="grid" setMainView={setMainView} unreadNotificationsCount={2} />);
    const clickerButton = screen.getByRole('button', { name: 'Clicker' });
    expect(clickerButton).toBeInTheDocument();
    fireEvent.click(clickerButton);
    expect(setMainView).toHaveBeenCalledWith('grid');

    // Ensure only one Alerts/Notifications button exists
    const notifButtons = screen.getAllByRole('button', { name: /notifications/i });
    expect(notifButtons.length).toBe(1);
  });
})

describe('CommandIsland count badges', () => {
  it('shows numbered circles for chat, notifications, and Arena players', async () => {
    const setMainView = vi.fn();
    render(
      <CommandIsland
        mainView="feed"
        setMainView={setMainView}
        unreadMessagesCount={3}
        unreadNotificationsCount={5}
        gamesOnlineCount={12}
      />,
    );
    expect(screen.getByRole('status', { name: '3 unread' })).toHaveTextContent('3');
    expect(screen.getByRole('status', { name: '5 unread' })).toHaveTextContent('5');
    expect(screen.getByRole('status', { name: '12 players online' })).toHaveTextContent('12');
  });

  it('hides badges at zero and caps large numbers at 99+', async () => {
    const setMainView = vi.fn();
    const { rerender } = render(
      <CommandIsland mainView="feed" setMainView={setMainView} />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(
      <CommandIsland
        mainView="feed"
        setMainView={setMainView}
        unreadMessagesCount={150}
        gamesOnlineCount={250}
      />,
    );
    const badges = screen.getAllByRole('status');
    expect(badges).toHaveLength(2);
    for (const b of badges) expect(b).toHaveTextContent('99+');
  });
})
