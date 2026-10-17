import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  persistKeepsake, resolveFreshLocalUrl, resolveKeepsakeLocal, resolveLocalMedia,
  releaseLocalUrl, retainLocalUrl, _resetLocalUrls,
} from './keepsake';

vi.mock('../utils/p2pSwarm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/p2pSwarm')>()
  return { ...mod, getLocalObject: vi.fn(async () => null) }
})
vi.mock('./vault', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./vault')>()
  return { ...mod, vaultGet: vi.fn(async () => null) }
})

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
    expect(r.ref).toBe('a'.repeat(64));
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
    expect(r).toEqual({ status: 'local', ref: 'b'.repeat(64), bytes: 300_000_000, via: 'vault-stream' });
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
    expect(await resolveFreshLocalUrl({ url: 'https://p/x.jpg', kind: 'image', saveState: 'failed' })).toBeNull()
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
    expect(resolveKeepsakeLocal(img({ saveState: 'downloading' }), {}, {})).toEqual({ kind: 'pending' });
    expect(resolveKeepsakeLocal(img({ saveState: 'failed' }), {}, {})).toEqual({ kind: 'failed' });
  });
  it('claimed-local-but-gone is missing (not failed), legacy is missing+recoverable', () => {
    expect(resolveKeepsakeLocal(img({ saveState: 'persisted' }), {}, {}))
      .toEqual({ kind: 'missing', legacy: false });
    expect(resolveKeepsakeLocal(img(), {}, {})).toEqual({ kind: 'missing', legacy: true });
  });
  it('never returns the provider URL (self-maps and remote are not local)', () => {
    const src = 'https://provider/x.jpg'
    // Legacy dev vault fallback wrote url->url: not proof of bytes.
    expect(resolveKeepsakeLocal(img({ url: src }), { [src]: src }, {}))
      .toEqual({ kind: 'missing', legacy: true });
    // A non-loopback remote value is equally rejected.
    expect(resolveKeepsakeLocal(img({ url: src, saveState: 'persisted' }), { [src]: 'https://cdn.other/y.jpg' }, {}))
      .toEqual({ kind: 'missing', legacy: false });
    // Loopback http (Electron vault server) IS local bytes.
    expect(resolveKeepsakeLocal(img({ url: src }), { [src]: 'http://127.0.0.1:9/v/x' }, {}))
      .toEqual({ kind: 'local', url: 'http://127.0.0.1:9/v/x', media: 'image' });
  });
});

describe('local blob URL ownership (Phase 9)', () => {
  const blob = new Blob(['local-bytes'], { type: 'image/jpeg' })
  let mintSeq = 0

  /** Mint a URL through the real resolver: the only way URLs enter the registry. */
  const mint = async (): Promise<string> => {
    const url = await resolveFreshLocalUrl({ url: 'https://p/x.jpg', kind: 'image', saveState: 'persisted' })
    if (!url) throw new Error('expected a minted local URL')
    return url
  }

  beforeEach(async () => {
    _resetLocalUrls()
    mintSeq = 0
    URL.createObjectURL = vi.fn(() => `blob:mint-${++mintSeq}`)
    URL.revokeObjectURL = vi.fn()
    const { getLocalObject } = await import('../utils/p2pSwarm')
    vi.mocked(getLocalObject).mockResolvedValue(blob)
  })

  afterEach(() => {
    _resetLocalUrls()
    vi.restoreAllMocks()
  })

  it('releaseLocalUrl revokes the minted URL and forgets it (idempotent)', async () => {
    const url = await mint()
    releaseLocalUrl(url)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    releaseLocalUrl(url)
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(1)
  })

  it('releasing an unknown or empty URL never revokes (ownership is strict)', () => {
    releaseLocalUrl('blob:never-minted')
    releaseLocalUrl('')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('reaps the oldest unclaimed URL once the cap is exceeded', async () => {
    const urls = [await mint(), await mint(), await mint(), await mint(), await mint()]
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[0])
    // The URL just handed to the caller is never reaped.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(urls[4])
  })

  it('never reaps a URL claimed by a new tab, even past the cap', async () => {
    const claimed = await mint()
    retainLocalUrl(claimed)
    const rest = [await mint(), await mint(), await mint(), await mint()]
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(claimed)
    // The cap still reaps an unclaimed neighbour rather than a live consumer.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(rest[0])
  })

  it('yields when every live URL is claimed (never breaks a live consumer)', async () => {
    for (let i = 0; i < 4; i += 1) retainLocalUrl(await mint())
    const fresh = await mint()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    releaseLocalUrl(fresh)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(fresh)
  })

  it('_resetLocalUrls revokes the whole registry (test seam)', async () => {
    const a = await mint()
    const b = await mint()
    _resetLocalUrls()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(b)
    releaseLocalUrl(a)
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(2)
  })
});

describe('resolveLocalMedia (honest local states)', () => {
  // The renderer bridge: the only way a vault probe can answer here (node env).
  const bridge = (impl: Record<string, unknown>) => vi.stubGlobal('window', { gmatch: impl })
  const keep = (over: { url?: string; kind?: 'image' | 'video'; localRef?: string } = {}) => ({
    url: 'https://provider/x.jpg',
    kind: 'image' as const,
    ...over,
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    _resetLocalUrls()
  })

  it('resolves the vault by content ref and hands out a browser-playable loopback URL', async () => {
    const ref = 'b'.repeat(64)
    const vaultGet = vi.fn(async (key: string) =>
      key === `vault://f/${ref}` ? { state: 'local', local: `vault://f/${ref}.jpg` } : { state: 'absent' },
    )
    bridge({ vaultGet, vaultHttpUrl: async () => ({ local: `http://127.0.0.1:9/f/${ref}.jpg` }) })

    await expect(resolveLocalMedia(keep({ localRef: ref }))).resolves.toEqual({
      state: 'local',
      url: `http://127.0.0.1:9/f/${ref}.jpg`,
    })
    // The keep's own identity is tried before the (possibly drifted) source url.
    expect(vaultGet).toHaveBeenCalledWith(`vault://f/${ref}`)
  })

  it('resolves a drifted-source keep through its content ref (the viewer bug)', async () => {
    const ref = 'e'.repeat(64)
    const vaultGet = vi.fn(async (key: string) =>
      key === `vault://f/${ref}` ? { state: 'local', local: 'vault://f/legacy.jpg' } : { state: 'absent' },
    )
    bridge({ vaultGet, vaultHttpUrl: async () => ({ local: 'http://127.0.0.1:9/f/legacy.jpg' }) })

    await expect(
      resolveFreshLocalUrl({ url: 'https://old-host/x.jpg', kind: 'image', saveState: 'persisted', localRef: ref }),
    ).resolves.toBe('http://127.0.0.1:9/f/legacy.jpg')
  })

  it('falls back to the source url for a legacy row with no ref', async () => {
    const vaultGet = vi.fn(async (key: string) =>
      key === 'https://provider/legacy.jpg' ? { state: 'local', local: 'vault://f/legacy.jpg' } : { state: 'absent' },
    )
    bridge({ vaultGet, vaultHttpUrl: async () => null })

    await expect(resolveLocalMedia(keep({ url: 'https://provider/legacy.jpg' }))).resolves.toEqual({
      state: 'local',
      url: 'vault://f/legacy.jpg',
    })
  })

  it('reports bytes that exist but cannot be read as unreadable, never as absent', async () => {
    bridge({ vaultGet: async () => ({ state: 'unreadable', reason: 'decrypt' }) })
    await expect(resolveLocalMedia(keep({ localRef: 'c'.repeat(64) }))).resolves.toEqual({
      state: 'unreadable',
      reason: 'decrypt',
    })
  })

  it('reports a broken bridge as unreadable (ipc), not as a missing file', async () => {
    bridge({ vaultGet: async () => { throw new Error('no handler') } })
    await expect(resolveLocalMedia(keep())).resolves.toEqual({ state: 'unreadable', reason: 'ipc' })
  })

  it('is absent only once the vault and the object store both miss', async () => {
    bridge({ vaultGet: async () => ({ state: 'absent' }) })
    await expect(resolveLocalMedia(keep())).resolves.toEqual({ state: 'absent' })
  })

  it('still resolves bytes for a keep marked failed (saveState is not proof)', async () => {
    bridge({ vaultGet: async () => ({ state: 'absent' }) })
    const { getLocalObject } = await import('../utils/p2pSwarm')
    vi.mocked(getLocalObject).mockResolvedValueOnce(new Blob(['bytes'], { type: 'image/jpeg' }))

    const r = await resolveLocalMedia(keep({ url: 'https://p/failed.jpg' }))
    expect(r.state).toBe('local')
  })
});
