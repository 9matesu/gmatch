// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});

import {
  enqueuePendingTransfer,
  listPendingTransfers,
  removePendingTransfer,
  resumePendingTransfers,
} from './pendingTransfers';

beforeEach(() => { mem.clear(); });

describe('pendingTransfers (Phase 4)', () => {
  it('enqueue is idempotent per id and persists', () => {
    enqueuePendingTransfer('o1', 'a'.repeat(64));
    enqueuePendingTransfer('o1', 'a'.repeat(64));
    expect(listPendingTransfers()).toHaveLength(1);
    expect(JSON.parse(mem.get('gmatch_pending_transfers_v1')!)).toHaveLength(1);
  });

  it('bounds queued records and rejects invalid identifiers and hashes', () => {
    enqueuePendingTransfer('', null)
    enqueuePendingTransfer('bad-hash', 'oops')
    for (let i = 0; i < 140; i += 1) enqueuePendingTransfer(`bounded-${i}`, null)
    expect(listPendingTransfers()).toHaveLength(128)
    expect(listPendingTransfers().some((entry) => entry.id === 'bounded-139')).toBe(true)
    expect(listPendingTransfers().some((entry) => entry.id === 'bad-hash')).toBe(false)
  });

  it('repairs malformed persisted entries before returning them', () => {
    mem.set('gmatch_pending_transfers_v1', JSON.stringify([
      { id: 'ok', hash: 'f'.repeat(64), attempts: 2, addedAt: 100 },
      { id: 'bad', hash: 'not-hash', attempts: -1, addedAt: 'soon' },
      { id: 'x'.repeat(257), hash: null, attempts: 0, addedAt: 100 },
    ]))
    const entries = listPendingTransfers()
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.id === 'bad')).toMatchObject({ id: 'bad', hash: null, attempts: 0 })
    expect(entries.find((e) => e.id === 'ok')).toEqual({ id: 'ok', hash: 'f'.repeat(64), attempts: 2, addedAt: 100 })
  });

  it('resume removes resolved transfers and keeps failures queued', async () => {
    enqueuePendingTransfer('ok', 'a'.repeat(64));
    enqueuePendingTransfer('off', 'b'.repeat(64));
    const resolve = vi.fn(async (id: string) => {
      if (id === 'off') throw new Error('seeder offline');
      return 'blob';
    });
    const r = await resumePendingTransfers(resolve);
    expect(r).toEqual({ resolved: 1, stillPending: 1 });
    expect(listPendingTransfers().map((e) => e.id)).toEqual(['off']);
    expect(listPendingTransfers()[0].attempts).toBe(1);
  });

  it('removePendingTransfer drops a single entry', () => {
    enqueuePendingTransfer('a', null);
    enqueuePendingTransfer('b', null);
    removePendingTransfer('a');
    expect(listPendingTransfers().map((e) => e.id)).toEqual(['b']);
  });
});
