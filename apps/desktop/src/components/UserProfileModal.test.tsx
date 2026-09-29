// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfileModal } from './UserProfileModal';
import type { User } from '@orbit/shared';

vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
}));
vi.mock('./feed/useProfilePostLightbox', () => ({
  useProfilePostLightbox: () => ({ openPost: vi.fn(), modals: null }),
}));

describe('UserProfileModal presence sync', () => {
  const baseUser: User = {
    id: 'u-1',
    display_name: 'Test User',
    publicKey: 'pk-1',
    createdAt: new Date().toISOString(),
  } as User;

  it('renders Offline for users with SQLite stale timestamp in negative UTC offset', () => {
    const sqliteStale = new Date(Date.now() - 2 * 3600_000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '')
      .slice(0, 19);

    render(
      <UserProfileModal
        user={{ ...baseUser, last_seen: sqliteStale }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('renders Online when last_seen is fresh', () => {
    const freshIso = new Date(Date.now() - 15_000).toISOString();
    render(
      <UserProfileModal
        user={{ ...baseUser, last_seen: freshIso }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('renders Offline when user has stale sighting even if online flag was true', () => {
    const staleIso = new Date(Date.now() - 120_000).toISOString();
    render(
      <UserProfileModal
        user={{ ...baseUser, last_seen: staleIso, online: true } as any}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  // THE SPLIT BRAIN. The modal used to do `users.find(...) || user`, so a
  // STALE roster entry unconditionally overrode a fresher record the caller
  // had just fetched (the chat hub hands one in from its 30s dashboard poll).
  // Result: Online in the chat list, Offline in the profile. These three pin
  // the fix — the fresher sighting wins, whichever side it is on.
  it('prefers the fresher of subject and roster instead of the roster', () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    render(
      <UserProfileModal
        user={{ ...baseUser, last_seen: stale } as User}
        users={[{ id: 'u-1', last_seen: fresh, online: true }]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('still honours a FRESHER roster entry over a stale subject', () => {
    const fresh = new Date(Date.now() - 5_000).toISOString();
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    render(
      <UserProfileModal
        user={{ ...baseUser, last_seen: fresh } as User}
        users={[{ id: 'u-1', last_seen: stale, online: false }]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  // The arena builds its object with no presence fields at all for anyone
  // outside the 100-row directory, and isUserOnline falls back to
  // Boolean(online) when there is no timestamp. Without the flag such a user
  // was permanently Offline in the modal while the badge beside the button
  // said Online.
  it('falls back to the online flag when neither record has a sighting', () => {
    render(
      <UserProfileModal
        user={{ ...baseUser } as User}
        users={[{ id: 'u-1', online: true }]}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Online')).toBeInTheDocument();
  });
});
