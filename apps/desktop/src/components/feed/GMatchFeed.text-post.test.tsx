// @vitest-environment jsdom
// A text-only post is a first-class post: a clean text card (author, words,
// actions) with NO media panel and NO placeholder. It is never hidden — the
// no-preview hide belongs to media bytes that failed to resolve, and a text
// post has no bytes to miss. Image posts keep their media path unchanged.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GMatchFeed, type FeedPost } from './GMatchFeed';

vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
  playMsgReceive: vi.fn(),
  playLikeOnce: vi.fn(),
}));

vi.mock('../../services/imageCache', () => ({
  resolveImage: vi.fn(async (u: string) => u),
  devFetchable: vi.fn(() => null),
  cachedImageFor: vi.fn(() => undefined),
}));

// If a text post ever mounted a media panel, this stand-in would report a
// terminal miss — the row would vanish. Its absence is the assertion.
vi.mock('../ObjectImage', () => ({
  ObjectImage: ({ onMediaUnavailable }: { onMediaUnavailable?: () => void }) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onMediaUnavailable?.(); }}>media panel</button>
  ),
}));

global.IntersectionObserver = vi.fn().mockImplementation((cb) => ({
  observe: vi.fn((el) => cb([{ isIntersecting: true, target: el }])),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

const identity = { orbitId: 'me', publicKeyHex: 'aa', privateKeyHex: 'bb' } as never;

function textPost(over: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'text-1',
    author_id: 'author-1',
    author_name: 'Text Author',
    created_at: new Date().toISOString(),
    caption: 'Just words, no picture at all.',
    url: '',
    media: [],
    mediaUrls: [],
    like_count: 3,
    comment_count: 2,
    ...over,
  } as FeedPost;
}

describe('GMatchFeed text posts', () => {
  it('renders author, words and actions with no image panel or placeholder', () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[textPost()]} stories={[]} users={[]} />,
    );

    const card = container.querySelector('article') as HTMLElement;
    expect(card).toBeTruthy();
    expect(screen.getByText('Just words, no picture at all.')).toBeTruthy();
    expect(screen.getByText('Text Author')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like post' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share post' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Expand post' })).toBeNull();
    expect(screen.queryByText(/media panel|No preview|Loading media/i)).toBeNull();
    expect(card.querySelector('img, video')).toBeNull();
    expect(card.querySelector('.group\\/post')).toBeNull();
  });

  it('never hides a text post when media would be unavailable', () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[textPost()]} stories={[]} users={[]} />,
    );
    // No ObjectImage mounted, so there is no onMediaUnavailable to hide it.
    expect(screen.queryByRole('button', { name: 'media panel' })).toBeNull();
    expect(container.querySelector('article')).toBeTruthy();
    expect(screen.getByText('Just words, no picture at all.')).toBeTruthy();
  });

  it('formats the body once — paragraphs and live links, no inline+expanded duplicate', () => {
    const { container } = render(
      <GMatchFeed
        identity={identity}
        posts={[textPost({ caption: 'First line.\n\nSecond line https://example.com' })]}
        stories={[]}
        users={[]}
      />,
    );
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeTruthy();
    expect(container.querySelectorAll('p').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(screen.getAllByText('First line.')).toHaveLength(1);
  });

  it('keeps an image post mounted when its media reports no bytes', () => {
    const image = textPost({
      id: 'image-1',
      caption: 'Still a picture post',
      url: '/api/objects/image-1',
      media: undefined,
    });
    const { container } = render(
      <GMatchFeed identity={identity} posts={[image]} stories={[]} users={[]} />,
    );
    expect(screen.getByText('Still a picture post')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'media panel' })).toBeTruthy();
    expect(container.querySelector('article .group\\/post')).toBeTruthy();
    // The tile stays mounted so the retry wave can fill it in; ObjectImage
    // collapses the media slot to zero height with no text and no spinner.
    // With its bytes gone the post is NOT a text card: its caption/actions hide
    // until the retry fills the media back in.
    fireEvent.click(screen.getByRole('button', { name: 'media panel' }));
    expect(container.querySelector('article')).not.toBeNull();
    expect(screen.queryByText('Still a picture post')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Like post' })).toBeNull();
    expect(screen.queryByText(/No preview|Loading media/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'media panel' })).toBeTruthy();
  });
});
