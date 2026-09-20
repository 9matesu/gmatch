// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { Avatar } from './Avatar';

vi.mock('../services/imageCache', () => ({
  resolveImage: vi.fn(async (url: string) =>
    url.includes('cached') ? 'gmcache://disk-hash' : url
  ),
  devFetchable: vi.fn((url: string) =>
    url.includes('dev-proxy') ? '/px?u=' + encodeURIComponent(url) : null
  ),
}));

describe('Avatar offline cache and fallback', () => {
  it('resolves image through disk cache when available', async () => {
    const { container } = render(<Avatar id="user-1" imageUrl="https://cdn.example.com/cached-pfp.jpg" />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'gmcache://disk-hash');
    });
  });

  it('falls back to geometric SVG without broken image on error', async () => {
    const { container } = render(<Avatar id="user-2" imageUrl="https://cdn.example.com/broken-pfp.jpg" />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    fireEvent.error(img!);
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  it('proxies external booru/CDN avatar URLs through /px in dev', async () => {
    const { container } = render(<Avatar id="user-3" imageUrl="https://cdn.example.com/dev-proxy-avatar.jpg" />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', '/px?u=https%3A%2F%2Fcdn.example.com%2Fdev-proxy-avatar.jpg');
    });
  });
});
