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
    expect(screen.getByText('Profile photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
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
});
