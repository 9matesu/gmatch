// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerRoster } from './PlayerRoster';

const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
});

describe('PlayerRoster profile pictures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders profile picture from player.pfp_url', () => {
    const players = [
      {
        id: 'user-1',
        display_name: 'Alice',
        pfp_url: 'https://example.com/alice.jpg',
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    const { container } = render(<PlayerRoster players={players} selfId="self-id" spectateRequesting={null} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/alice.jpg');
  });

  it('renders profile picture from profilePics map when player.pfp_url is null', () => {
    const players = [
      {
        id: 'user-2',
        display_name: 'Bob',
        pfp_url: null,
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    const profilePics = { 'user-2': 'https://example.com/bob.jpg' };
    const { container } = render(
      <PlayerRoster players={players} selfId="self-id" spectateRequesting={null} profilePics={profilePics} />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/bob.jpg');
  });

  it('falls back to users list pfp_url when player.pfp_url is null', () => {
    const players = [
      {
        id: 'user-3',
        display_name: 'Charlie',
        pfp_url: null,
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    const users = [
      {
        id: 'user-3',
        display_name: 'Charlie',
        pfp_url: 'https://example.com/charlie.jpg',
      } as any,
    ];
    const { container } = render(<PlayerRoster players={players} selfId="self-id" spectateRequesting={null} users={users} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/charlie.jpg');
  });

  it('falls back to localStorage orbit_pfp_url for self when player.pfp_url is null', () => {
    const players = [
      {
        id: 'self-id',
        display_name: 'Self',
        pfp_url: null,
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    localStorage.setItem('orbit_pfp_url', 'https://example.com/self.jpg');
    const { container } = render(<PlayerRoster players={players} selfId="self-id" spectateRequesting={null} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/self.jpg');
  });
});
