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
});
