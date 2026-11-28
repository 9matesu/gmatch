// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfileModal } from './UserProfileModal';
import type { User } from '@orbit/shared';
import { rememberName, __resetNameDirectoryForTests } from '../game/nameDirectory';

/**
 * A peer's profile used to be an empty shell: a raw <img> for the avatar (a
 * `urn:sha256:` ref the browser cannot fetch), post/cards tiles that never
 * handed the content hash to the resolver, cards filtered out when they had no
 * `content_url`, and a name read from the stale opener object. These pin the
 * one rule: every media surface goes through ObjectImage with a real address,
 * and names come from the durable signed-name directory.
 */

vi.mock('../utils/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/api')>(),
  // Never settles: the count request is not under test and must not produce a
  // state update after the assertion.
  orbitFetch: vi.fn(() => new Promise(() => {})),
  invalidateCache: vi.fn(),
}));
vi.mock('./feed/useProfilePostLightbox', () => ({
  useProfilePostLightbox: () => ({ openPost: vi.fn(), expandedNode: null, modals: null }),
}));
vi.mock('./ObjectImage', () => ({
  ObjectImage: ({ contentUrl, objectId, contentHash, alt }: any) => (
    <img
      data-testid="object-image"
      data-url={contentUrl || ''}
      data-object={objectId || ''}
      data-hash={contentHash || ''}
      alt={alt || ''}
    />
  ),
}));

const HASH = 'b'.repeat(64);
const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' } as any;
const baseUser: User = {
  id: 'u-1',
  display_name: 'Stale Name',
  publicKey: 'pk-1',
  createdAt: new Date().toISOString(),
} as User;

describe('UserProfileModal media + name resolution', () => {
  beforeEach(() => {
    __resetNameDirectoryForTests();
    vi.clearAllMocks();
  });
  afterEach(() => __resetNameDirectoryForTests());

  it('renders the avatar through ObjectImage with the content address from a urn ref', () => {
    render(
      <UserProfileModal
        user={baseUser}
        profilePic={`urn:sha256:${HASH}`}
        identity={identity}
        onClose={() => {}}
      />,
    );
    const avatar = screen.getAllByTestId('object-image')[0];
    expect(avatar).toHaveAttribute('data-hash', HASH);
    expect(avatar).toHaveAttribute('data-url', `urn:sha256:${HASH}`);
  });

  it('hands the post content hash to the resolver so peer bytes can be fetched', () => {
    render(
      <UserProfileModal
        user={baseUser}
        identity={identity}
        posts={[{
          id: 'peer-post-1', author_id: 'u-1', url: '/api/objects/peer-post-1',
          content_hash: HASH, caption: 'a peer picture', created_at: new Date().toISOString(),
        } as any]}
        onClose={() => {}}
      />,
    );
    const tiles = screen.getAllByTestId('object-image');
    expect(tiles.some((t) => t.getAttribute('data-hash') === HASH)).toBe(true);
  });

  it('lists a card whose media lives only as a local object (no content_url)', () => {
    render(
      <UserProfileModal
        user={baseUser}
        identity={identity}
        cards={[{ id: 'card-1', owner_id: 'u-1', mime_type: 'image/jpeg' } as any]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Cards \(1\)/)).toBeInTheDocument();
    const tiles = screen.getAllByTestId('object-image');
    expect(tiles.some((t) => t.getAttribute('data-object') === 'card-1')).toBe(true);
  });

  it('shows the durable signed display name without the peer re-saving', () => {
    rememberName('u-1', 'Fresh Signed Name');
    render(<UserProfileModal user={baseUser} onClose={() => {}} />);
    expect(screen.getByText('@Fresh Signed Name')).toBeInTheDocument();
    expect(screen.queryByText('@Stale Name')).toBeNull();
  });
});
