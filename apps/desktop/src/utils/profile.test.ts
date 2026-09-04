import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveProfileTags, profileIsComplete, saveUserProfile } from './profile';

const apiMock = vi.hoisted(() => ({ orbitFetch: vi.fn() }));
vi.mock('./api', () => ({ orbitFetch: apiMock.orbitFetch }));

const identity = { orbitId: 'a'.repeat(64), publicKeyHex: 'pk', privateKeyHex: 'sk' } as any;

describe('deriveProfileTags', () => {
  it('unions tags from the user own posts (in-game source of truth)', () => {
    const ownPosts = [{ tags: ['Anime', '#art'] }, { tags: ['anime', 'gaming'] }, { tags: null }];
    expect(deriveProfileTags(ownPosts)).toEqual(['anime', 'art', 'gaming']);
  });

  it('seeds from stored profile tags until the player starts posting', () => {
    expect(deriveProfileTags([], ['veteran'])).toEqual(['veteran']);
    const ownPosts = [{ tags: ['gaming'] }];
    expect(deriveProfileTags(ownPosts, ['veteran', 'gaming'])).toEqual(['gaming', 'veteran']);
  });

  it('caps at five tags and strips blacklisted ones', () => {
    const ownPosts = [{ tags: ['one', 'two', 'three', 'four', 'five', 'six'] }, { tags: ['loli', 'ok'] }];
    const derived = deriveProfileTags(ownPosts);
    expect(derived).toHaveLength(5);
    expect(derived).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(derived).not.toContain('loli');
  });

  it('drops non-array tag values', () => {
    expect(deriveProfileTags([{ tags: 'anime' as any }], [])).toEqual([]);
  });
});

describe('profileIsComplete', () => {
  it('requires name, at least one tag and a picture', () => {
    expect(profileIsComplete('Alex', ['anime'], 'data:image/jpeg;base64,x')).toBe(true);
    expect(profileIsComplete('  ', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('Alex', [], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('Alex', ['anime'], '')).toBe(false);
  });

  it('rejects pre-generated and default user names', () => {
    expect(profileIsComplete('user--123', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('user-abc', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('User_123456', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('User_unknown', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
    expect(profileIsComplete('Anonymous', ['anime'], 'data:image/jpeg;base64,x')).toBe(false);
  });
});

describe('saveUserProfile', () => {
  beforeEach(() => apiMock.orbitFetch.mockReset());

  it('builds the canonical PATCH payload through the single helper', async () => {
    apiMock.orbitFetch.mockResolvedValue({ ok: true, status: 200 });
    const res = await saveUserProfile(identity, {
      display_name: ' Alex Rivers ',
      tags: [' Anime ', '#art', 'art'],
      pfp_url: 'data:image/jpeg;base64,x',
    });

    expect(res.ok).toBe(true);
    expect(apiMock.orbitFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiMock.orbitFetch.mock.calls[0];
    expect(url).toBe('/api/users/profile');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      display_name: ' Alex Rivers ',
      tags: ['anime', 'art'],
      pfp_url: 'data:image/jpeg;base64,x',
    });
  });

  it('reports failure status', async () => {
    apiMock.orbitFetch.mockResolvedValue({ ok: false, status: 409 });
    const res = await saveUserProfile(identity, { bio: 'x' });
    expect(res).toEqual({ ok: false, status: 409 });
  });
});