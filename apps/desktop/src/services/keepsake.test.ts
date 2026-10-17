import { describe, expect, it, vi } from 'vitest';
import { persistKeepsake, resolveFreshLocalUrl, resolveKeepsakeLocal } from './keepsake';

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
    expect(r.status).toBe('local');
    expect(r.hash).toBe('a'.repeat(64));
    expect(r.via).toBe('idb');
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

  it('video takes the streaming vault route (no full-memory buffer, no image cap)', async () => {
    const d = deps({
      pinStream: vi.fn(async () => ({ ok: true, key: 'k.mp4', mime: 'video/mp4', bytes: 300_000_000, hash: 'b'.repeat(64) })),
      vaultReadBack: vi.fn(async () => 'vault://f/k.mp4'),
    });
    const r = await persistKeepsake('https://x/clip.mp4', d, 'video');
    expect(r).toEqual({ status: 'local', hash: 'b'.repeat(64), bytes: 300_000_000, via: 'vault-stream' });
    // Whole-file route never ran: no full buffer for a 300MB clip.
    expect(d.fetchFile).not.toHaveBeenCalled();
    expect(d.storeBytes).not.toHaveBeenCalled();
  });

  it('streaming quota failure is terminal and honest (no silent remote)', async () => {
    const d = deps({
      pinStream: vi.fn(async () => ({ ok: false, reason: 'quota' })),
    });
    const r = await persistKeepsake('https://x/huge.mp4', d, 'video');
    expect(r).toEqual({ status: 'failed', reason: 'quota' });
  });

  it('streaming read-back miss fails the save (never mark partial complete)', async () => {
    const d = deps({
      pinStream: vi.fn(async () => ({ ok: true, key: 'k.mp4', mime: 'video/mp4', bytes: 10, hash: 'b'.repeat(64) })),
      vaultReadBack: vi.fn(async () => null),
    });
    const r = await persistKeepsake('https://x/clip.mp4', d, 'video');
    expect(r).toEqual({ status: 'failed', reason: 'readback' });
  });

  it('no bridge in dev: video falls back to the whole-file route', async () => {
    const d = deps({ pinStream: vi.fn(async () => null) });
    const r = await persistKeepsake('https://x/clip.mp4', d, 'video');
    expect(r.status).toBe('local');
    expect(d.fetchFile).toHaveBeenCalledWith('https://x/clip.mp4');
  });
})

describe('resolveFreshLocalUrl (action-time, never remote)', () => {
  it('returns null for failed keeps and empty urls', async () => {
    expect(await resolveFreshLocalUrl({ url: '', kind: 'image' })).toBeNull()
    expect(await resolveFreshLocalUrl({ url: 'https://p/x.jpg', kind: 'image', localStatus: 'failed' })).toBeNull()
  })
})

describe('resolveKeepsakeLocal (never remote)', () => {
  const img = (over: Record<string, unknown> = {}) => ({
    url: 'https://provider/x.jpg',
    kind: 'image' as const,
    ...over,
  });
  it('verified vault/blob URL wins, media typed', () => {
    expect(resolveKeepsakeLocal(img({ kind: 'video' }), { 'https://provider/x.jpg': 'vault://f/k.mp4' }, {}))
      .toEqual({ kind: 'local', url: 'vault://f/k.mp4', media: 'video' });
    expect(resolveKeepsakeLocal(img(), {}, { 'https://provider/x.jpg': 'blob:local' }))
      .toEqual({ kind: 'local', url: 'blob:local', media: 'image' });
  });
  it('pending / failed pass through', () => {
    expect(resolveKeepsakeLocal(img({ localStatus: 'pending' }), {}, {})).toEqual({ kind: 'pending' });
    expect(resolveKeepsakeLocal(img({ localStatus: 'failed' }), {}, {})).toEqual({ kind: 'failed' });
  });
  it('claimed-local-but-gone is missing (not failed), legacy is missing+recoverable', () => {
    expect(resolveKeepsakeLocal(img({ localStatus: 'local' }), {}, {}))
      .toEqual({ kind: 'missing', legacy: false });
    expect(resolveKeepsakeLocal(img(), {}, {})).toEqual({ kind: 'missing', legacy: true });
  });
  it('never returns the provider URL (self-maps and remote are not local)', () => {
    const src = 'https://provider/x.jpg'
    // Legacy dev vault fallback wrote url->url: not proof of bytes.
    expect(resolveKeepsakeLocal(img({ url: src }), { [src]: src }, {}))
      .toEqual({ kind: 'missing', legacy: true });
    // A non-loopback remote value is equally rejected.
    expect(resolveKeepsakeLocal(img({ url: src, localStatus: 'local' }), { [src]: 'https://cdn.other/y.jpg' }, {}))
      .toEqual({ kind: 'missing', legacy: false });
    // Loopback http (Electron vault server) IS local bytes.
    expect(resolveKeepsakeLocal(img({ url: src }), { [src]: 'http://127.0.0.1:9/v/x' }, {}))
      .toEqual({ kind: 'local', url: 'http://127.0.0.1:9/v/x', media: 'image' });
  });
});
