// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { Avatar } from './Avatar';

vi.mock('../services/imageCache', () => ({
  resolveImage: vi.fn(async (url: string) =>
    url.includes('cached') ? 'gmcache://disk-hash' : url
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
});
