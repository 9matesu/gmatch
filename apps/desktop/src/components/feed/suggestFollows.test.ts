import { describe, expect, it } from 'vitest';
import { suggestFollows, type SuggestUser } from './suggestFollows';

const u = (id: string, tags: string[], followers = 0, online = false): SuggestUser =>
  ({ id, display_name: id, tags, followers_count: followers, online });

describe('suggestFollows', () => {
  const users = [
    u('me', ['cars']), u('a', ['foot', 'leather'], 5, true),
    u('b', ['cars'], 99, false), u('c', ['food'], 50, true),
  ];
  it('excludes self and followed, ranks online+affinity first', () => {
    const got = suggestFollows(users, 'me', ['foot'], new Set(['c']));
    expect(got.map((x) => x.id)).toEqual(['a', 'b']); // a: online+affinity, b: follower-count tie-break
  });
  it('with no affinity signal, online then followers decides', () => {
    expect(suggestFollows(users, 'me', [], new Set()).map((x) => x.id))
      .toEqual(['c', 'a', 'b']); // c online 50f, a online 5f, b offline 99f
  });
  it('caps at limit', () => {
    const many = [u('x1', [], 1, true), u('x2', [], 2, true), u('x3', [], 3, true), u('x4', [], 4, true)];
    expect(suggestFollows(many, null, [], new Set())).toHaveLength(3);
  });
  it('empty input -> empty output', () => {
    expect(suggestFollows([], 'me', [], new Set())).toEqual([]);
  });
});
