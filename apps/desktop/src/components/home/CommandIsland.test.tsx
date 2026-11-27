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
    expect(screen.queryByText('Domination')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByText('Domination')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.queryByText('Domination')).not.toBeInTheDocument()
  })

  it('Clicker button appears on the pill and the island carries no notification entry point', async () => {
    const setMainView = vi.fn();
    render(<CommandIsland mainView="grid" setMainView={setMainView} />);
    const clickerButton = screen.getByRole('button', { name: 'Clicker' });
    expect(clickerButton).toBeInTheDocument();
    fireEvent.click(clickerButton);
    expect(setMainView).toHaveBeenCalledWith('grid');

    // Notifications live in the single header centre now: the footer island
    // must not mount a second bell, and the E2E hook (the toggle attribute)
    // must appear exactly once in the app — never here.
    expect(screen.queryByRole('button', { name: /notifications|alerts/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-notifications-toggle="true"]')).toBeNull();
  });
})

describe('CommandIsland grid size control (T-W3)', () => {
  it('does not render layout control on pill bar (moved to game header)', () => {
    render(<CommandIsland mainView="grid" setMainView={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Grid size' })).not.toBeInTheDocument()
  })
})

describe('CommandIsland count badges', () => {
  it('shows numbered circles for chat and Arena players', async () => {
    const setMainView = vi.fn();
    render(
      <CommandIsland
        mainView="feed"
        setMainView={setMainView}
        unreadMessagesCount={3}
        gamesOnlineCount={12}
      />,
    );
    expect(screen.getByRole('status', { name: '3 unread' })).toHaveTextContent('3');
    expect(screen.getByRole('status', { name: '12 in lobby' })).toHaveTextContent('12');
  });

  it('Watch + Feed pills show their count badges', () => {
    render(
      <CommandIsland
        mainView="games"
        setMainView={vi.fn()}
        watchWatchingCount={7}
        feedNewPostsCount={3}
      />,
    );
    const watch = screen.getByRole('button', { name: /Watch/i })
    expect(watch.querySelector('[role="status"]')).toHaveTextContent('7')
    const feed = screen.getByRole('button', { name: /Feed/i })
    expect(feed.querySelector('[role="status"]')).toHaveTextContent('3')
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
});

describe('CommandIsland styling & layout compliance', () => {
  it('pill bar keeps one row and scrolls silently instead of spilling, and the picker lives outside it', () => {
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Command Island' });
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).toContain('flex-nowrap');
    expect(nav.className).not.toContain('styled-scrollbar');
    expect(nav.className).not.toContain('flex-1');
  });

  it('servers button is uncolored and does not have text-retro-online green', async () => {
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} />);
    openMore();
    const serversButton = screen.getByRole('button', { name: 'Servers' });
    expect(serversButton).toBeInTheDocument();
    const icon = serversButton.querySelector('svg');
    expect(icon?.className.baseVal || icon?.getAttribute('class') || '').not.toContain('text-retro-online');
  });
});

describe('CommandIsland post button (footer, centered, one picker flow)', () => {
  it('carries no balance counter: the g$ ledger lives in the Vault, not the chrome', () => {
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} />);
    expect(screen.queryByLabelText(/Balance:/)).toBeNull();
  });

  it('clicking Post toggles the media-picker bubble (one flow, no second modal)', () => {
    const onPickMedia = vi.fn();
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} onOpenCreatePost={vi.fn()} onPickMedia={onPickMedia} />);

    // Click toggles the bubble.
    fireEvent.click(screen.getByLabelText('Create a post'));
    const dialog = screen.getByRole('dialog', { name: 'Pick post media' });
    // The bubble must not live inside the dock: the island translates itself by
    // -50%, which makes it a containing block for fixed children and clipped
    // the bubble to the pill's height before.
    expect(dialog.closest('nav')).toBeNull();

    // A second click closes it again.
    fireEvent.click(screen.getByLabelText('Create a post'));
    expect(screen.queryByRole('dialog', { name: 'Pick post media' })).toBeNull();
  });

  it('the bubble is STABLE: leaving the trigger or switching panes keeps it open', () => {
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} onOpenCreatePost={vi.fn()} onPickMedia={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Create a post'));
    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();
    // Hovering out (the old close trigger) must NOT dismiss it.
    fireEvent.mouseLeave(screen.getByLabelText('Create a post').parentElement!);
    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();
    // Clicking a pane tab keeps it open — the trap this slice removes.
    fireEvent.click(screen.getByText('Paste URL'));
    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();
  });

  it('closes on an outside pointerdown and on Escape', () => {
    render(<CommandIsland mainView="feed" setMainView={vi.fn()} onOpenCreatePost={vi.fn()} onPickMedia={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Create a post'));
    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Pick post media' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Create a post'));
    expect(screen.getByRole('dialog', { name: 'Pick post media' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Pick post media' })).toBeNull();
  });
});
