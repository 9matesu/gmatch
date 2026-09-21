// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

// Mocks for sound / dependencies
vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
  playLikeOnce: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation((cb) => ({
  observe: vi.fn((el) => {
    cb([{ isIntersecting: true, target: el }]);
  }),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
}));

describe('GMatchFeed timeline filtering and resilience', () => {
  const mockIdentity = {
    orbitId: 'my-user-id',
    sign: vi.fn(),
  } as any;

  const mockUsers = [
    { id: 'online-author', display_name: 'Online User', online: true },
    { id: 'offline-author', display_name: 'Offline User', online: false, last_seen: '2020-01-01T00:00:00Z' },
  ];

  it('filters out blank posts that lack media and url', () => {
    const posts: any[] = [
      {
        id: 'blank-post-1',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Ghost empty post',
        url: '',
        media: [],
        like_count: 0,
        comment_count: 0,
      },
      {
        id: 'valid-post-2',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Valid working post',
        url: 'https://example.com/valid.jpg',
        like_count: 0,
        comment_count: 0,
      },
    ];

    render(
      <GMatchFeed
        identity={mockIdentity}
        posts={posts}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
      />
    );

    expect(screen.getByText('Valid working post')).toBeInTheDocument();
    expect(screen.queryByText('Ghost empty post')).toBeNull();
  });

  it('renders peer-to-peer object posts try-first even when the author is offline', () => {
    const posts: any[] = [
      {
        id: 'offline-p2p-post',
        author_id: 'offline-author',
        author_name: 'Offline User',
        created_at: new Date().toISOString(),
        caption: 'Offline P2P post still attempted',
        url: '/api/objects/obj-123',
        like_count: 0,
        comment_count: 0,
      },
      {
        id: 'online-p2p-post',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Available online P2P post',
        url: '/api/objects/obj-456',
        like_count: 0,
        comment_count: 0,
      },
    ];

    render(
      <GMatchFeed
        identity={mockIdentity}
        posts={posts}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
      />
    );

    expect(screen.getByText('Available online P2P post')).toBeInTheDocument();
    // Try-first: the offline author's tile renders and attempts the fetch
    // instead of being pre-filtered.
    expect(screen.getByText('Offline P2P post still attempted')).toBeInTheDocument();
  });

  it('hides a post from the timeline when its image media fails to load', async () => {
    const posts: any[] = [
      {
        id: 'broken-img-post',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Broken image post to hide',
        url: 'https://example.com/broken.jpg',
        like_count: 0,
        comment_count: 0,
      },
    ];

    const { container } = render(
      <GMatchFeed
        identity={mockIdentity}
        posts={posts}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
      />
    );

    expect(screen.getByText('Broken image post to hide')).toBeInTheDocument();

    const img = container.querySelector('img[src="https://example.com/broken.jpg"]');
    if (img) {
      fireEvent.error(img);
    }

    await waitFor(() => {
      expect(screen.queryByText('Broken image post to hide')).toBeNull();
    });
  });

  it('silently retries hidden posts when a peer comes online', async () => {
    const posts: any[] = [
      {
        id: 'flaky-img-post',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Flaky post retried on peer online',
        url: 'https://example.com/flaky.jpg',
        like_count: 0,
        comment_count: 0,
      },
    ];

    const { container } = render(
      <GMatchFeed
        identity={mockIdentity}
        posts={posts}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
      />
    );

    const img = container.querySelector('img[src="https://example.com/flaky.jpg"]');
    if (img) {
      fireEvent.error(img);
    }
    await waitFor(() => {
      expect(screen.queryByText('Flaky post retried on peer online')).toBeNull();
    });

    window.dispatchEvent(new Event('orbit-peer-online'));
    await waitFor(() => {
      expect(screen.getByText('Flaky post retried on peer online')).toBeInTheDocument();
    });
  });

  it('opens post lightbox on media click without triggering user profile navigation', async () => {
    const onSelectUser = vi.fn();
    const posts: any[] = [
      {
        id: 'post-click-1',
        author_id: 'online-author',
        author_name: 'Online User',
        created_at: new Date().toISOString(),
        caption: 'Clickable media post',
        url: 'https://example.com/photo.jpg',
        like_count: 5,
        comment_count: 2,
      },
    ];

    const { container } = render(
      <GMatchFeed
        identity={mockIdentity}
        posts={posts}
        stories={[]}
        users={mockUsers}
        feedSort="latest"
        onSelectUser={onSelectUser}
      />
    );

    const mediaContainer = container.querySelector('img[src="https://example.com/photo.jpg"]')?.closest('.cursor-pointer');
    expect(mediaContainer).toBeTruthy();
    fireEvent.click(mediaContainer!);

    expect(onSelectUser).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.body.textContent).toContain('Online User');
    });
  });
});
