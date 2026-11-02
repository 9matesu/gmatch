// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('GMatchFeed composer', () => {
  const identity = { orbitId: 'me', publicKeyHex: '1', privateKeyHex: '2' };

  it('opens the composer in one click from the top of the feed', () => {
    const onOpenPostCreator = vi.fn();
    const { getByRole } = render(
      <GMatchFeed
        identity={identity as never}
        posts={[]}
        stories={[]}
        onOpenPostCreator={onOpenPostCreator}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Create a post' }));

    expect(onOpenPostCreator).toHaveBeenCalledTimes(1);
  });

  it('hides the composer when the feed has no write path', () => {
    const { queryByRole } = render(
      <GMatchFeed identity={identity as never} posts={[]} stories={[]} />,
    );

    expect(queryByRole('button', { name: 'Create a post' })).toBeNull();
  });
});
