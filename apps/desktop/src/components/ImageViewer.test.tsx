// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './ImageViewer';

vi.mock('./ObjectImage', () => ({
  ObjectImage: ({ objectId }: { objectId: string }) => <span data-testid={`object-image-${objectId}`} />,
}));

const identity = {
  orbitId: 'user-1',
  publicKeyHex: 'public',
  privateKeyHex: 'private',
} as never;

const item = {
  id: 'item-1',
  owner_id: 'user-1',
  size_bytes: 12,
  mime_type: 'image/jpeg',
  created_at: '2026-01-01T00:00:00.000Z',
  content_url: 'https://example.test/card.jpg',
} as never;

describe('ImageViewer controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a consistently sized bottom action bar', () => {
    render(
      <ImageViewer
        itemId="item-1"
        items={[item]}
        identity={identity}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
        onSetWallpaper={vi.fn()}
        onToggleFavorite={vi.fn(async () => true)}
      />,
    );

    const actions = ['Download', 'Copy Link', 'Favorite', 'Set Background', 'Delete']
      .map((label) => screen.getByRole('button', { name: new RegExp(label, 'i') }));

    expect(actions).toHaveLength(5);
    for (const action of actions) {
      expect(action.className).toContain('glass-action');
      expect(action.className).toContain('h-9');
    }
  });
});
