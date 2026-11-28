// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfileModal } from './UserProfileModal';
import type { OrbitObject, User } from '@orbit/shared';

// The chatroom profile used to receive EVERY gallery row as `cards`, so an
// uploaded image/video landed on the Cards shelf. Pin the shelf to minted
// cards only; uploads remain posts/chat attachments/keepsakes elsewhere.
vi.mock('../utils/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/api')>(),
  orbitFetch: vi.fn(() => new Promise(() => {})),
  invalidateCache: vi.fn(),
}));
vi.mock('./feed/useProfilePostLightbox', () => ({
  useProfilePostLightbox: () => ({ openPost: vi.fn(), expandedNode: null, modals: null }),
}));
vi.mock('./ObjectImage', () => ({
  ObjectImage: ({ objectId, alt }: any) => (
    <img data-testid="object-image" data-object={objectId || ''} alt={alt || ''} />
  ),
}));

const user: User = {
  id: 'u-cards-shelf',
  display_name: 'Cards User',
  publicKey: 'pk-cards',
  createdAt: new Date().toISOString(),
} as User;

const row = (id: string, extra: Record<string, unknown> = {}): OrbitObject => ({
  id,
  owner_id: user.id,
  size_bytes: 1,
  mime_type: 'image/jpeg',
  created_at: new Date().toISOString(),
  ...extra,
} as OrbitObject);

describe('UserProfileModal cards shelf', () => {
  it('shows only the minted card when handed the raw gallery rows', () => {
    render(
      <UserProfileModal
        user={user}
        cards={[
          row('chat-upload', { is_chat: 1 }),
          row('post-upload', { is_public: 1 }),
          row('story-upload', { is_story: 1 }),
          row('minted-media', { card_id: 'card-1' }),
          { ...row('peer-card', { card_id: 'card-2' }), owner_id: 'another-user' },
        ]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Cards (1)')).toBeInTheDocument();
    const tiles = screen.getAllByTestId('object-image');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute('data-object', 'minted-media');
  });
});
