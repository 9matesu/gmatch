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
    enqueuePendingTransfer('o1', 'h1');
    enqueuePendingTransfer('o1', 'h1');
    expect(listPendingTransfers()).toHaveLength(1);
    expect(JSON.parse(mem.get('gmatch_pending_transfers_v1')!)).toHaveLength(1);
  });

  it('resume removes resolved transfers and keeps failures queued', async () => {
    enqueuePendingTransfer('ok', 'h-ok');
    enqueuePendingTransfer('off', 'h-off');
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
