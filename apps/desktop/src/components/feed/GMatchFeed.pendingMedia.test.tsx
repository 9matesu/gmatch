// @vitest-environment jsdom
// A row with no words is content only once its bytes are real. Until then it must
// not appear and must not flash: it is probed, then promoted or dropped for good.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

// Local-object store: bytes are available for the descriptor post below.
vi.mock('../../utils/p2pSwarm', () => ({
  getLocalObject: vi.fn(async () => new Blob(['x'])),
  PEER_ONLINE_EVENT: 'orbit-peer-online',
}));

const identity = { orbitId: 'me', publicKeyHex: 'aa', privateKeyHex: 'bb' } as never;

const imagePost = {
  id: 'pending-1',
  author_id: 'author-1',
  author_name: 'Au Thor',
  created_at: new Date().toISOString(),
  caption: '',
  url: 'https://cdn.test/pending.jpg',
  like_count: 0,
  comment_count: 0,
};

/** jsdom never loads images: the probe's own handlers are what the test fires. */
const probes: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];

beforeEach(() => {
  vi.spyOn(globalThis, 'Image').mockImplementation(() => {
    const img = { onload: null, onerror: null, src: '' };
    probes.push(img);
    return img as unknown as HTMLImageElement;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  probes.length = 0;
});

describe('a text-less row waits for its bytes', () => {
  it('does not appear while the media is in flight', () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[imagePost]} stories={[]} users={[]} />,
    );
    // No article at all: an empty frame is worse than a missing row.
    expect(container.querySelector('article')).toBeNull();
    // The probe is running, so this is "pending", not "nothing to show".
    expect(probes.length).toBe(1);
  });

  it('appears once the media resolves (late data)', async () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[imagePost]} stories={[]} users={[]} />,
    );
    expect(container.querySelector('article')).toBeNull();

    probes[0].onload?.();
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
  });

  it('never appears when the media never arrives', async () => {
    const { container } = render(
      <GMatchFeed identity={identity} posts={[imagePost]} stories={[]} users={[]} />,
    );
    probes[0].onerror?.();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('article')).toBeNull();
  });

  it('a captioned post shows immediately, media or not', () => {
    const { container } = render(
      <GMatchFeed
        identity={identity}
        posts={[{ ...imagePost, id: 'captioned', caption: 'words are content' }]}
        stories={[]}
        users={[]}
      />,
    );
    expect(container.querySelector('article')).not.toBeNull();
    expect(screen.getByText('words are content')).toBeTruthy();
  });

  it('a text-less local-object post appears once its bytes resolve locally', async () => {
    const { container } = render(
      <GMatchFeed
        identity={identity}
        posts={[{ ...imagePost, id: 'obj-1', url: `magnet:?xt=urn:btih:${'a'.repeat(40)}` }]}
        stories={[]}
        users={[]}
      />,
    );
    // Hidden until the local store answers, then promoted (no infinite wait).
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
  });
});