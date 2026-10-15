import { describe, expect, it, vi } from 'vitest';
import { persistKeepsake } from './keepsake';

const imgFile = () => new File(['image-bytes'], 'x.jpg', { type: 'image/jpeg' });

function deps(over: Record<string, unknown> = {}) {
  const stored = new Map<string, File>();
  return {
    stored,
    fetchFile: vi.fn(async () => imgFile()),
    storeBytes: vi.fn((key: string, f: File) => { stored.set(key, f); }),
    readBack: vi.fn(async (key: string) => stored.get(key) ?? null),
    hash: vi.fn(async () => 'a'.repeat(64)),
    pin: vi.fn(async () => 'vault://x'),
    ...over,
  };
}

describe('persistKeepsake (Phase 5)', () => {
  it('stores bytes, verifies read-back, returns local + hash', async () => {
    const d = deps();
    const r = await persistKeepsake('https://x/pic.jpg', d);
    expect(r).toEqual({ status: 'local', hash: 'a'.repeat(64) });
    expect(d.storeBytes).toHaveBeenCalledWith('https://x/pic.jpg', expect.any(File));
    expect(d.storeBytes).toHaveBeenCalledWith('a'.repeat(64), expect.any(File));
    expect(d.readBack).toHaveBeenCalledWith('https://x/pic.jpg');
  });

  it('download failure => failed, no store, keeps nothing false', async () => {
    const d = deps({ fetchFile: vi.fn(async () => { throw new Error('source refused'); }) });
    const r = await persistKeepsake('https://x/gone.jpg', d);
    expect(r.status).toBe('failed');
    expect(d.storeBytes).not.toHaveBeenCalled();
  });

  it('non-media bytes are rejected', async () => {
    const d = deps({ fetchFile: vi.fn(async () => new File(['x'], 'x.txt', { type: 'text/plain' })) });
    const r = await persistKeepsake('https://x/x.txt', d);
    expect(r).toEqual({ status: 'failed', reason: 'not-media' });
  });

  it('read-back mismatch (object not truly stored) => failed', async () => {
    const d = deps({ readBack: vi.fn(async () => null) });
    const r = await persistKeepsake('https://x/pic.jpg', d);
    expect(r).toEqual({ status: 'failed', reason: 'readback' });
  });

  it('vault pin failure does not fail the save (IndexedDB copy stands)', async () => {
    const d = deps({ pin: vi.fn(async () => { throw new Error('vault off'); }) });
    const r = await persistKeepsake('https://x/pic.jpg', d);
    expect(r.status).toBe('local');
  })
});
