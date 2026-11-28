// @vitest-environment jsdom
// A row whose media bytes cannot be resolved stays MOUNTED as a zero-height,
// textless, spinnerless tile. App.tsx's reconcile (60s / focus / peer-online)
// dispatches MEDIA_RETRY_EVENT; useObjectImage re-resolves and the SAME mounted
// tile promotes when the bytes arrive. Unmounting the row here would break that
// whole path — the retry has nothing left to fill.
import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';
import { MEDIA_RETRY_EVENT } from '../../hooks/useObjectImage';

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

// Stands in for ObjectImage: reports "no bytes" with a zero-height, textless
// element, then mirrors useObjectImage's retry listener by showing the media
// after MEDIA_RETRY_EVENT. The feed must never unmount between the two, and it
// must not relabel the dead tile as a text post while the retry is pending.
vi.mock('../ObjectImage', () => ({
  ObjectImage: (props: any) => {
    const [hasBytes, setHasBytes] = useState(false);
    useEffect(() => {
      const retry = () => setHasBytes(true);
      window.addEventListener('gmatch-media-retry', retry);
      return () => window.removeEventListener('gmatch-media-retry', retry);
    }, []);
    if (hasBytes) return <img data-testid="media-ready" src={props.contentUrl} alt="" />;
    return (
      <>
        <button
          type="button"
          data-testid="media-waiting"
          className="h-0 w-full"
          onClick={(e) => { e.stopPropagation(); props.onMediaUnavailable?.(); }}
        />
        {/* delivers bytes with NO retry wave: isolates the onLoad path */}
        <button
          type="button"
          data-testid="media-load-direct"
          onClick={(e) => { e.stopPropagation(); setHasBytes(true); props.onLoad?.(); }}
        />
      </>
    );
  },
}));

global.IntersectionObserver = vi.fn().mockImplementation((cb) => ({
  observe: vi.fn((el) => cb([{ isIntersecting: true, target: el }])),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})) as any;

describe('GMatchFeed media without bytes', () => {
  const identity = { orbitId: 'my-user-id', sign: vi.fn() } as any;
  const posts: any[] = [
    {
      id: 'missing-post',
      author_id: 'my-user-id',
      author_name: 'Me',
      created_at: new Date().toISOString(),
      caption: 'My own post without local bytes',
      url: '/api/objects/missing-post',
      like_count: 0,
      comment_count: 0,
    },
  ];

  const renderFeed = () => {
    let result!: ReturnType<typeof render>;
    // The observer stub fires on mount; keep its state update inside act.
    act(() => {
      result = render(<GMatchFeed identity={identity} posts={posts} stories={[]} users={[]} feedSort="latest" />);
    });
    return result;
  };

  it('keeps the tile mounted at zero height but hides author, caption and actions after a terminal miss', () => {
    const { container } = renderFeed();
    expect(container.querySelector('article')).not.toBeNull();
    expect(screen.getByText('My own post without local bytes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like post' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('media-waiting'));

    // The row is still here — only its media slot collapsed to zero height.
    expect(container.querySelector('article')).not.toBeNull();
    const waiting = screen.getByTestId('media-waiting');
    expect(waiting.className).toContain('h-0');
    expect(waiting.textContent).toBe('');
    // A dead MEDIA post must not masquerade as a text card: the words, author
    // and actions are hidden until bytes can be resolved again. No new label.
    expect(screen.queryByText('My own post without local bytes')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Like post' })).toBeNull();
    expect(screen.queryByTestId('post-author-overlay')).toBeNull();
    expect(screen.queryByText(/No preview|Loading media/i)).toBeNull();
  });

  it('promotes the SAME mounted tile when the retry wave delivers bytes', () => {
    const { container } = renderFeed();
    fireEvent.click(screen.getByTestId('media-waiting'));
    expect(container.querySelector('article')).not.toBeNull();

    expect(MEDIA_RETRY_EVENT).toBe('gmatch-media-retry');
    act(() => { window.dispatchEvent(new Event(MEDIA_RETRY_EVENT)); });

    expect(screen.getByTestId('media-ready')).toBeInTheDocument();
    expect(container.querySelector('article')).not.toBeNull();
    expect(screen.queryByTestId('media-waiting')).toBeNull();
    // The dead mark is cleared on the retry wave, so the SAME mounted tile
    // shows its author/caption/actions again as the bytes arrive.
    expect(screen.getByText('My own post without local bytes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like post' })).toBeTruthy();
  });

  it('wires onLoad so the first arriving bytes also clear the dead mark (no retry)', () => {
    const { container } = renderFeed();
    fireEvent.click(screen.getByTestId('media-waiting'));
    expect(screen.queryByRole('button', { name: 'Like post' })).toBeNull();
    // No MEDIA_RETRY_EVENT: only the feed's onLoad handler can promote the row.
    fireEvent.click(screen.getByTestId('media-load-direct'));
    expect(screen.getByTestId('media-ready')).toBeInTheDocument();
    expect(container.querySelector('article')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Like post' })).toBeTruthy();
  });
});
