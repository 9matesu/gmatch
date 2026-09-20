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
});
