// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countChatUnread, countThreadUnread } from './chatUnread';

const NOW = 1_000_000;

describe('countThreadUnread', () => {
  it('counts inbound messages newer than the seen stamp', () => {
    const msgs = [
      { ts: NOW - 10, senderOrbitId: 'bob' },
      { ts: NOW - 5, senderOrbitId: 'bob' },
      { ts: NOW - 50, senderOrbitId: 'bob' },
    ];
    expect(countThreadUnread(msgs, NOW - 20, 'me')).toBe(2);
  });

  it('excludes own messages and self-sent echoes', () => {
    const msgs = [
      { ts: NOW - 1, own: true },
      { ts: NOW - 1, senderOrbitId: 'me' },
      { ts: NOW - 1, senderOrbitId: 'bob' },
    ];
    expect(countThreadUnread(msgs, 0, 'me')).toBe(1);
  });

  it('does not keep a badge lit for a deleted message', () => {
    const msgs = [
      { ts: NOW - 1, senderOrbitId: 'bob', deletedTs: NOW },
      { ts: NOW - 2, senderOrbitId: 'bob' },
    ];
    expect(countThreadUnread(msgs, 0, 'me')).toBe(1);
  });

  it('treats missing stamp as everything-unseen, tolerates garbage', () => {
    expect(countThreadUnread([{ ts: NOW - 1 }], undefined, 'me')).toBe(1);
    expect(countThreadUnread(null, 0, 'me')).toBe(0);
    expect(countThreadUnread(undefined, 0, 'me')).toBe(0);
    expect(countThreadUnread([{ ts: NaN } as never], 0, 'me')).toBe(0);
  });
});

describe('countChatUnread', () => {
  it('sums threads + rooms + legacy server lane', () => {
    const total = countChatUnread({
      threads: {
        bob: [
          { ts: NOW - 1, senderOrbitId: 'bob' },
          { ts: NOW - 2, senderOrbitId: 'bob' },
        ],
        alice: [{ ts: NOW - 1, senderOrbitId: 'alice' }],
      },
      dmSeen: { bob: NOW - 10, alice: NOW },
      roomIds: ['r1'],
      roomMessages: (id) => (id === 'r1' ? [{ ts: NOW - 1, senderOrbitId: 'carol' }] : []),
      roomSeen: { r1: 0 },
      selfId: 'me',
      serverUnread: 2,
    });
    // bob: 2 new, alice: seen, room: 1, server: 2
    expect(total).toBe(5);
  });

  it('returns 0 when everything is seen', () => {
    expect(
      countChatUnread({
        threads: { bob: [{ ts: NOW - 5, senderOrbitId: 'bob' }] },
        dmSeen: { bob: NOW },
        roomIds: [],
        selfId: 'me',
        serverUnread: 0,
      }),
    ).toBe(0);
  });
});
