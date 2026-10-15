// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
  playLikeOnce: vi.fn(),
}));

(global as any).IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
}));

const mockIdentity = { orbitId: 'me', sign: vi.fn() } as any;
const mockUsers = [{ id: 'alice', display_name: 'Alice', online: true }];

function post(id: string, caption: string) {
  return {
    id,
    author_id: 'alice',
    author_name: 'Alice',
    created_at: new Date().toISOString(),
    caption,
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 0,
    comment_count: 0,
  } as any;
}

function renderTwo(onPersistComment?: (postId: string, text: string) => Promise<any>) {
  return render(
    <GMatchFeed
      identity={mockIdentity}
      posts={[post('p1', 'first'), post('p2', 'second')]}
      stories={[]}
      users={mockUsers}
      feedSort="latest"
      onPersistComment={onPersistComment}
    />,
  );
}

const expanders = () => screen.getAllByLabelText('Expand post');
const articleOf = (id: string) =>
  document.querySelector(`[data-post-id="${id}"]`);

beforeEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('inline post expansion', () => {
  it('clicking the image expands inline with no modal dialog', () => {
    renderTwo();
    const before = articleOf('p1');
    expect(before).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Add a comment...')).toBeNull();
    fireEvent.click(expanders()[0]);
    // Same card element (no remount, scroll position preserved)...
    expect(articleOf('p1')).toBe(before);
    // ...now carrying the thread + composer...
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
    // ...and no portal dialog anywhere.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('collapse control returns to the compact layout', () => {
    renderTwo();
    fireEvent.click(expanders()[0]);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse post'));
    expect(screen.queryByPlaceholderText('Add a comment...')).toBeNull();
    // Card still in place.
    expect(articleOf('p1')).toBeInTheDocument();
  });

  it('only one post expands at a time', () => {
    renderTwo();
    const [first, second] = expanders();
    fireEvent.click(first);
    expect(screen.getAllByPlaceholderText('Add a comment...')).toHaveLength(1);
    fireEvent.click(second);
    const composers = screen.getAllByPlaceholderText('Add a comment...');
    expect(composers).toHaveLength(1);
    expect(articleOf('p2')!.contains(composers[0])).toBe(true);
  });

  it('comments work inline: composer posts through the existing handler', async () => {
    const serverComment = {
      id: 'c1', author_id: 'me', author_name: 'You', text: 'nice',
      created_at: new Date().toISOString(), like_count: 0,
    };
    const onPersistComment = vi.fn(async () => serverComment);
    renderTwo(onPersistComment);
    fireEvent.click(expanders()[0]);
    const input = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(input, { target: { value: 'nice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(onPersistComment).toHaveBeenCalledWith('p1', 'nice');
    await waitFor(() => expect(screen.getByText('nice')).toBeInTheDocument());
  });

  it('deep link #/feed?post= expands the target inline', async () => {
    window.location.hash = '#/feed?post=p2';
    renderTwo();
    await waitFor(() => expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    window.location.hash = '';
  });

  it('zoom pill cycles bounded levels and resets on collapse', () => {
    renderTwo();
    fireEvent.click(expanders()[0]);
    const zoom = screen.getByLabelText('Zoom image');
    expect(zoom).toHaveTextContent('100%');
    fireEvent.click(zoom);
    expect(screen.getByLabelText('Reset zoom')).toHaveTextContent('180%');
    fireEvent.click(screen.getByLabelText('Reset zoom'));
    expect(screen.getByLabelText('Reset zoom')).toHaveTextContent('260%');
    fireEvent.click(screen.getByLabelText('Reset zoom'));
    expect(screen.getByLabelText('Zoom image')).toHaveTextContent('100%');
    // Collapse resets zoom for the next open.
    fireEvent.click(screen.getByLabelText('Collapse post'));
    fireEvent.click(expanders()[0]);
    expect(screen.getByLabelText('Zoom image')).toHaveTextContent('100%');
  });
});
