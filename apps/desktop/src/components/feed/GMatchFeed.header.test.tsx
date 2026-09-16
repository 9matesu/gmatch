// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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

describe('GMatchFeed header layout', () => {
  const identity = { orbitId: 'me', publicKeyHex: '1', privateKeyHex: '2' };

  const renderFeed = () =>
    render(
      <GMatchFeed
        identity={identity as never}
        posts={[]}
        stories={[]}
        users={[]}
        feedCols="2"
        onFeedColsChange={vi.fn()}
      />,
    );

  it('renders the FeedHeader as the very first element of the feed', () => {
    const { container } = renderFeed();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.firstElementChild?.tagName.toLowerCase()).toBe('header');
  });

  it('puts the 1-5 column picker inside the header, exactly once', () => {
    const { container } = renderFeed();
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header!.querySelector('[aria-label="3-column feed"]')).toBeTruthy();
    expect(container.querySelectorAll('[aria-label="3-column feed"]').length).toBe(1);
  });

  it('drops the plain "Timeline" label from the header', () => {
    const { container } = renderFeed();
    const header = container.querySelector('header') as HTMLElement;
    expect(header.textContent).not.toContain('Timeline');
  });
});