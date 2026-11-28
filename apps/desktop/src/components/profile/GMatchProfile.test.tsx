// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GMatchProfile } from './GMatchProfile';

// Mock useCropper hook
vi.mock('../../hooks/useCropper', () => ({
  useCropper: () => ({
    crop: vi.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,cropped', file: null }),
    cropper: null,
  }),
}));

// Mock sounds
vi.mock('../../utils/sounds', () => ({
  playPress: vi.fn(),
  playWin: vi.fn(),
}));

// Mock profile save
vi.mock('../../utils/profile', () => ({
  saveUserProfile: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  fileToThumbDataUrl: vi.fn().mockImplementation(async () => 'data:image/jpeg;base64,thumb'),
}));

describe('GMatchProfile', () => {
  const fakeIdentity = {
    orbitId: 'user_123',
    publicKey: 'pk_123',
  } as any;

  const fakeUser = {
    id: 'user_123',
    name: 'Alice',
    display_name: 'Alice Wonder',
    bio: 'Hello world',
    pfp_url: 'https://example.com/pfp.jpg',
  };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'image/jpeg' })),
    }) as unknown as typeof fetch;
  });

  it('renders profile with user details', () => {
    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
      />
    );
    expect(screen.getByText('Alice Wonder')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('opens ProfilePicModal when clicking avatar for self', async () => {
    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
      />
    );
    const avatarButton = screen.getByRole('button', { name: 'Change profile photo' });
    await userEvent.click(avatarButton);
    // The profile photo flow IS the shared media picker now (no second modal).
    expect(await screen.findByRole('dialog', { name: 'Pick a profile photo' })).toBeInTheDocument();
  });

  it('opens ProfileEditorModal when clicking Edit profile', async () => {
    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
      />
    );
    const editButton = screen.getByRole('button', { name: 'Edit profile' });
    await userEvent.click(editButton);
    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('updates following count dynamically on the tab from followingIds', () => {
    const { rerender } = render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        followingIds={['user_2', 'user_3']}
      />
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('following')).toBeInTheDocument();

    rerender(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        followingIds={['user_2', 'user_3', 'user_4']}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('the Saved tab lists the saved posts it was given, not the feed snapshot', async () => {
    // The tab used to be fed by `feedPosts.filter(p => p.is_saved)` — the
    // 50-row timeline snapshot. A post saved yesterday that fell out of the
    // feed was therefore invisible: "saving posts does not work". The tab
    // takes its own list now, read from the node with ?saved=1.
    const savedPost = {
      id: 'saved-1',
      url: '/api/objects/saved-1',
      mime_type: 'image/png',
      author_id: 'someone_else',
      created_at: '2026-01-01T00:00:00.000Z',
    } as any;

    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        savedPosts={[savedPost]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /saved/i }));
    expect(screen.queryByText('No saved posts')).not.toBeInTheDocument();
    expect(document.querySelector('[data-post-id="saved-1"]')).toBeInTheDocument();
  });

  it('the Saved tab says so when there is nothing saved', async () => {
    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        savedPosts={[]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /saved/i }));
    expect(screen.getByText('No saved posts')).toBeInTheDocument();
  });

  it('renders text posts as chronological cards, never as media grid cells', () => {
    const older = {
      id: 'text-old', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'Older words',
      url: '', created_at: '2026-10-24T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const newer = {
      id: 'text-new', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'Newer words',
      url: '', created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const { container } = render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[older, newer]}
        cards={[]}
      />
    );
    const cards = screen.getAllByTestId('profile-text-post');
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute('data-post-id')).toBe('text-new');
    expect(cards[1].getAttribute('data-post-id')).toBe('text-old');
    expect(container.querySelector('[data-post-id="text-old"] img')).toBeNull();
    expect(screen.queryByText(/No preview|Loading media/i)).toBeNull();
    expect(container.querySelector('.grid-cols-3')).toBeNull();
  });

  it('keeps media posts in the media grid', () => {
    const media = {
      id: 'media-1', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'a picture',
      url: '/api/objects/media-1', created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const { container } = render(
      <GMatchProfile identity={fakeIdentity} myUser={fakeUser} posts={[media]} cards={[]} />,
    );
    expect(screen.queryByTestId('profile-text-post')).toBeNull();
    expect(container.querySelector('[data-post-id="media-1"]')).toBeTruthy();
  });

  it('renders an already-saved text card with a filled bookmark on first paint', async () => {
    const savedText = {
      id: 'text-saved', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'Kept words',
      url: '', created_at: '2026-10-26T12:00:00.000Z', like_count: 3, is_saved: true,
    } as any;
    render(
      <GMatchProfile identity={fakeIdentity} myUser={fakeUser} posts={[savedText]} cards={[]} />,
    );
    const save = screen.getByRole('button', { name: 'Remove from saved' });
    expect(save).toHaveAttribute('aria-pressed', 'true');
    expect(save.innerHTML).toContain('fill-retro-fg');
    // Seeded from the row, not from a click: the first click UNSAVES it.
    await userEvent.click(save);
    expect(screen.getByRole('button', { name: 'Save post' })).toBeInTheDocument();
  });

  it('interleaves text cards and media grid rows in one chronological list', () => {
    const text = (id: string, stamp: string) => ({
      id, author_id: 'user_123', author_name: 'Alice Wonder', caption: id,
      url: '', created_at: stamp, like_count: 0, comment_count: 0,
    }) as any;
    const media = {
      id: 'media-mid', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'middle picture',
      url: '/api/objects/media-mid', created_at: '2026-10-26T12:00:00.000Z',
      like_count: 0, comment_count: 0,
    } as any;
    const { container } = render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[media, text('text-old', '2026-10-25T12:00:00.000Z'), text('text-new', '2026-10-27T12:00:00.000Z')]}
        cards={[]}
      />,
    );
    const ids = Array.from(container.querySelectorAll('[data-post-id]')).map((el) => el.getAttribute('data-post-id'));
    expect(ids).toEqual(['text-new', 'media-mid', 'text-old']);
    expect(container.querySelectorAll('[data-testid="profile-post-grid"]')).toHaveLength(1);
    expect(container.querySelector('.grid-cols-3')).toBeNull();
  });

  it('uses one card shape for text and image posts with the same action row', () => {
    const text = {
      id: 'only-text', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'Words only',
      url: '', created_at: '2026-10-27T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const media = {
      id: 'only-media', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'A picture',
      url: 'https://example.com/picture.jpg', mime_type: 'image/jpeg',
      created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const { container } = render(
      <GMatchProfile identity={fakeIdentity} myUser={fakeUser} posts={[text, media]} cards={[]} />,
    );
    expect(screen.getByTestId('profile-text-post').getAttribute('data-profile-post-kind')).toBe('text');
    expect(screen.getByTestId('profile-media-post').getAttribute('data-profile-post-kind')).toBe('media');
    const likeButtons = screen.getAllByRole('button', { name: 'Like post' });
    const saveButtons = screen.getAllByRole('button', { name: 'Save post' });
    expect(likeButtons).toHaveLength(2);
    expect(saveButtons).toHaveLength(2);
    expect(screen.queryByText(/No preview|Loading media/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="profile-media-post"] img')).not.toBeNull();
  });

  it('drops a duplicated post id from the profile grid', () => {
    const media = {
      id: 'same-id', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'one post',
      url: 'https://example.com/picture.jpg', mime_type: 'image/jpeg',
      created_at: '2026-10-26T12:00:00.000Z', like_count: 0, comment_count: 0,
    } as any;
    const { container } = render(
      <GMatchProfile identity={fakeIdentity} myUser={fakeUser} posts={[media, { ...media }]} cards={[]} />,
    );
    expect(container.querySelectorAll('[data-post-id="same-id"]')).toHaveLength(1);
  });

  it('sorts zone-less SQLite stamps as UTC, like the ISO rows', () => {
    const text = (id: string, stamp: string) => ({
      id, author_id: 'user_123', author_name: 'Alice Wonder', caption: id,
      url: '', created_at: stamp, like_count: 0, comment_count: 0,
    }) as any;
    const { container } = render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[text('iso-older', '2026-10-26T11:00:00.000Z'), text('sqlite-newer', '2026-10-26 12:00:00')]}
        cards={[]}
      />,
    );
    const ids = Array.from(container.querySelectorAll('[data-post-id]')).map((el) => el.getAttribute('data-post-id'));
    expect(ids).toEqual(['sqlite-newer', 'iso-older']);
  });

  it('opens a Comment expansion from a Saved tab text card', async () => {
    const savedText = {
      id: 'saved-comment', author_id: 'user_123', author_name: 'Alice Wonder', caption: 'Saved words',
      url: '', created_at: '2026-10-26T12:00:00.000Z', like_count: 0, is_saved: true,
    } as any;
    const { container } = render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        savedPosts={[savedText]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /saved/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(container.querySelector('[data-expanded-post="saved-comment"]')).toBeInTheDocument();
  });

  it('header aligns avatar, name and readable counts with a single action row', () => {
    render(
      <GMatchProfile
        identity={fakeIdentity}
        myUser={fakeUser}
        posts={[]}
        cards={[]}
        followingIds={['user_2']}
      />,
    );
    // Avatar + name are present.
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument();
    expect(screen.getByText('Alice Wonder')).toBeInTheDocument();
    // The three counts are readable (the number is the larger, tabular step).
    for (const label of ['posts', 'followers', 'following']) {
      const labelEl = screen.getByText(label);
      const valueEl = labelEl.previousElementSibling as HTMLElement;
      expect(valueEl.className).toContain('text-lg');
      expect(valueEl.className).toContain('tabular-nums');
    }
    // Exactly ONE of each action — no duplicated action rows.
    expect(screen.getAllByRole('button', { name: 'Edit profile' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Share' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Profile settings' })).toHaveLength(1);
  });
});
