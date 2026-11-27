// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
}));

(global as any).IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
  cachedImageFor: vi.fn(() => undefined),
}));

const mockIdentity = { orbitId: 'me', sign: vi.fn() } as any;

function post(id: string, authorId: string) {
  return {
    id,
    author_id: authorId,
    author_name: authorId === 'me' ? 'You' : 'Alice',
    created_at: new Date().toISOString(),
    caption: 'a caption',
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 0,
    comment_count: 0,
  } as any;
}

function renderFeed(opts: {
  posts: any[];
  onEditPost?: (p: any) => void;
  onDeletePost?: (id: string) => void;
  onReportPost?: (p: any) => void;
}) {
  return render(
    <GMatchFeed
      identity={mockIdentity}
      posts={opts.posts}
      stories={[]}
      users={[]}
      feedSort="latest"
      onEditPost={opts.onEditPost}
      onDeletePost={opts.onDeletePost}
    />,
  );
}

function rightClickPost(id: string) {
  const article = document.querySelector(`[data-post-id="${id}"]`) as HTMLElement;
  expect(article).toBeTruthy();
  fireEvent.contextMenu(article, { clientX: 120, clientY: 240 });
}

beforeEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('the post context menu (right-click replaces the three dots)', () => {
  it('right-clicking a post opens the menu at the cursor', () => {
    renderFeed({ posts: [post('p1', 'alice')] });
    rightClickPost('p1');
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('240px');
  });

  it('the three-dots button is GONE', () => {
    renderFeed({ posts: [post('p1', 'alice')] });
    expect(screen.queryByLabelText('Post options')).toBeNull();
  });

  it('a NON-owner gets Report and never the owner-only rows', () => {
    renderFeed({ posts: [post('p1', 'alice')] });
    rightClickPost('p1');
    expect(screen.getByRole('menuitem', { name: 'Report Post' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit post' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete Post' })).toBeNull();
  });

  it('the OWNER gets Edit and Delete', () => {
    renderFeed({
      posts: [post('p1', 'me')],
      onEditPost: vi.fn(),
      onDeletePost: vi.fn(),
    });
    rightClickPost('p1');
    expect(screen.getByRole('menuitem', { name: 'Edit post' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete Post' })).toBeTruthy();
    // An owner never reports themselves.
    expect(screen.queryByRole('menuitem', { name: 'Report Post' })).toBeNull();
  });

  it('Edit fires the caller handler with the post', () => {
    const onEditPost = vi.fn();
    renderFeed({ posts: [post('p1', 'me')], onEditPost });
    rightClickPost('p1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit post' }));
    expect(onEditPost).toHaveBeenCalledTimes(1);
    expect(onEditPost.mock.calls[0][0].id).toBe('p1');
  });

  it('Delete fires the caller handler with the post id', () => {
    const onDeletePost = vi.fn();
    renderFeed({ posts: [post('p1', 'me')], onDeletePost });
    rightClickPost('p1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Post' }));
    expect(onDeletePost).toHaveBeenCalledWith('p1');
  });

  it('the menu closes after an action', () => {
    renderFeed({ posts: [post('p1', 'me')], onDeletePost: vi.fn() });
    rightClickPost('p1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Post' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
