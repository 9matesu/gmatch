// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const mockUsers = [{ id: 'alice', display_name: 'Alice', online: true }];

function post(id: string, caption: string, comments?: any[], ageMs = 0) {
  return {
    id,
    author_id: 'alice',
    author_name: 'Alice',
    created_at: new Date(Date.now() - ageMs).toISOString(),
    caption,
    url: 'https://example.com/1.jpg',
    tags: [],
    like_count: 0,
    comment_count: 0,
    ...(comments ? { comments } : {}),
  } as any;
}

function renderTwo(
  onPersistComment?: (postId: string, text: string, parentCommentId?: string | null) => Promise<any>,
  commentsById?: Record<string, any[]>,
) {
  return render(
    <GMatchFeed
      identity={mockIdentity}
      posts={[post('p1', 'first', commentsById?.p1, 0), post('p2', 'second', commentsById?.p2, 1000)]}
      stories={[]}
      users={mockUsers}
      feedSort="latest"
      onPersistComment={onPersistComment}
    />,
  );
}

const expanders = () => screen.getAllByLabelText('Expand post');
const sheet = () => document.querySelector('aside[role="complementary"]');

beforeEach(() => {
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('post detail side sheet', () => {
  it('clicking the image opens the post side sheet (not an inline expand)', () => {
    renderTwo();
    expect(sheet()).toBeNull();
    fireEvent.click(expanders()[0]);
    expect(sheet()).not.toBeNull();
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
    // No modal dialog: it is a complementary side sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the sheet returns to the compact timeline', () => {
    renderTwo();
    fireEvent.click(expanders()[0]);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByPlaceholderText('Add a comment...')).toBeNull();
    expect(sheet()).toBeNull();
  });

  it('only one post sheet is open at a time', () => {
    renderTwo();
    const [first, second] = expanders();
    fireEvent.click(first);
    fireEvent.click(second);
    expect(screen.getAllByPlaceholderText('Add a comment...')).toHaveLength(1);
    expect(screen.getAllByPlaceholderText('Add a comment...')[0].closest('aside')).not.toBeNull();
  });

  it('comments post through the existing handler', async () => {
    const serverComment = {
      id: 'c1', author_id: 'me', author_name: 'You', text: 'nice',
      created_at: new Date().toISOString(), like_count: 0,
    };
    const onPersistComment = vi.fn(async () => serverComment);
    renderTwo(onPersistComment);
    fireEvent.click(expanders()[0]);
    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), { target: { value: 'nice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(onPersistComment).toHaveBeenCalledWith('p1', 'nice', null);
    await waitFor(() => expect(screen.getAllByText('nice').length).toBeGreaterThan(0));
  });

  it('deep link #/feed?post= opens the target in the sheet', async () => {
    window.location.hash = '#/feed?post=p2';
    renderTwo();
    await waitFor(() => expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument());
    expect(sheet()).not.toBeNull();
    window.location.hash = '';
  });
});