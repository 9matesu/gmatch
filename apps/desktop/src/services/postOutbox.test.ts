// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';

// Manual storage stub (repo convention): the jsdom pragma is unreliable
// when vitest runs from the workspace root.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});
import {
  enqueueOutbox,
  listOutbox,
  setOutboxState,
  pruneOutbox,
  flushPostOutbox,
  OUTBOX_KEY,
} from './postOutbox';

const identity = { orbitId: 'me-1' } as never;

const regBody = (id: string) => ({ id, content_hash: 'a'.repeat(64), mime_type: 'image/jpeg', is_public: true });
const gossipInput = (id: string) => ({
  id, contentHash: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 10, magnetUri: 'magnet:?xt=urn:btih:aa',
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('postOutbox store (Phase 3b)', () => {
  it('enqueue/list round-trip with local state', () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: gossipInput('o1') });
    const list = listOutbox();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ objectId: 'o1', state: 'local', attempts: 0 });
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY)!)).toHaveLength(1);
  });

  it('re-enqueue never downgrades state', () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: null });
    setOutboxState('o1', 'replicated');
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: null });
    expect(listOutbox()[0].state).toBe('replicated');
  });

  it('pruneOutbox drops only replicated entries past the grace window', () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: null });
    enqueueOutbox({ objectId: 'o2', postGroup: null, registerBody: regBody('o2'), gossipInput: null });
    setOutboxState('o1', 'replicated');
    pruneOutbox(0, Date.now() + 1);
    expect(listOutbox().map((e) => e.objectId)).toEqual(['o2']);
  });
});

describe('flushPostOutbox worker', () => {
  const deps = (reg: (b: unknown) => Promise<{ ok: boolean; terminal?: boolean }>, gos: (i: unknown) => Promise<boolean>) => ({
    postRegister: vi.fn(reg),
    postGossip: vi.fn(gos),
  });

  it('local -> pending -> replicated across flushes', async () => {
    enqueueOutbox({ objectId: 'o1', postGroup: 'pg', registerBody: regBody('o1'), gossipInput: gossipInput('o1') });
    const d = deps(async () => ({ ok: true }), async () => false);
    let s = await flushPostOutbox(identity, d);
    expect(s).toMatchObject({ registered: 1, replicated: 0 });
    expect(listOutbox()[0].state).toBe('pending');
    d.postGossip.mockImplementation(async () => true);
    s = await flushPostOutbox(identity, d);
    expect(s).toMatchObject({ replicated: 1 });
    expect(listOutbox()[0].state).toBe('replicated');
  });

  it('register failure keeps local and counts attempts (offline-safe)', async () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: gossipInput('o1') });
    const d = deps(async () => ({ ok: false }), async () => true);
    const s = await flushPostOutbox(identity, d);
    expect(s).toMatchObject({ registered: 0, failed: 1 });
    const e = listOutbox()[0];
    expect(e.state).toBe('local');
    expect(e.attempts).toBe(1);
    expect(d.postGossip).not.toHaveBeenCalled();
  });

  it('non-gossipable entries complete right after register', async () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: null });
    const d = deps(async () => ({ ok: true }), async () => { throw new Error('must not gossip'); });
    const s = await flushPostOutbox(identity, d);
    expect(s).toMatchObject({ registered: 1, replicated: 1 });
    expect(listOutbox()[0].state).toBe('replicated');
  });

  it('409 (foreign owner) is terminal: entry dropped, no infinite retry', async () => {
    enqueueOutbox({ objectId: 'o1', postGroup: null, registerBody: regBody('o1'), gossipInput: null });
    const d = deps(async () => ({ ok: false, terminal: true }), async () => true);
    const s = await flushPostOutbox(identity, d);
    expect(s).toMatchObject({ failed: 1 });
    expect(listOutbox()).toHaveLength(0);
  });
});
