import { describe, it, expect, vi } from 'vitest';
import { dataUrlToBlob, dataUrlToFile, localObjectBlobUrl } from './mediaData';

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL and infers the mime type', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,aGVsbG8='); // "hello"
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('hello');
  });

  it('falls back to image/jpeg when the mime is missing', async () => {
    const blob = dataUrlToBlob('data:;base64,YWJj'); // "abc"
    expect(blob.type).toBe('image/jpeg');
    expect(await blob.text()).toBe('abc');
  });

  it('handles an empty payload without throwing', () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,');
    expect(blob.size).toBe(0);
  });

  it('decodes video mimes too', () => {
    expect(dataUrlToBlob('data:video/mp4;base64,AAA=').type).toBe('video/mp4');
  });
});

/**
 * The paste-a-data-URL path. Six call sites used to inline this decode; they
 * all go through dataUrlToFile now, so the behaviour is pinned once here.
 */
describe('dataUrlToFile', () => {
  it('turns a base64 data URL into a File with the declared type', () => {
    const file = dataUrlToFile('data:image/png;base64,aGVsbG8=', 'x.png');
    expect(file).not.toBeNull();
    expect(file!.type).toBe('image/png');
    expect(file!.name).toBe('x.png');
  });

  it('honours the caller-supplied filename', () => {
    const file = dataUrlToFile('data:image/jpeg;base64,YWJj', 'card-123.jpg');
    expect(file!.name).toBe('card-123.jpg');
  });

  it('returns null for a plain http(s) link (the caller treats it as a URL)', () => {
    expect(dataUrlToFile('https://example.com/x.png')).toBeNull();
  });

  it('returns null for an undecodable payload instead of throwing', () => {
    expect(() => dataUrlToFile('data:image/png;base64,!!!not-base64!!!')).not.toThrow();
    expect(dataUrlToFile('data:image/png;base64,!!!not-base64!!!')).toBeNull();
  });
});

describe('localObjectBlobUrl', () => {
  it('returns an empty string for missing or empty data', () => {
    expect(localObjectBlobUrl('a', undefined, 'image/png')).toBe('');
    expect(localObjectBlobUrl('b', new ArrayBuffer(0), 'image/png')).toBe('');
  });

  it('creates a blob: URL for real bytes', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const url = localObjectBlobUrl('obj-1', buf, 'image/png');
    expect(url.startsWith('blob:')).toBe(true);
  });

  it('caches one URL per object id (stable across calls)', () => {
    const buf = new Uint8Array([9]).buffer;
    const first = localObjectBlobUrl('obj-2', buf, 'image/png');
    const second = localObjectBlobUrl('obj-2', new Uint8Array([8]).buffer, 'image/png');
    expect(second).toBe(first);
  });
});

describe('localObjectBlobUrl: bounded LRU (plan B1)', () => {
  it('revokes the least-recently-used URL past the cap', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const buf = new Uint8Array([1]).buffer;
    // Fill well past the cap (512) with unique ids.
    for (let i = 0; i < 520; i++) localObjectBlobUrl(`lru-${i}`, buf, 'image/png');
    // The oldest ids were evicted: asking again with data mints a NEW url.
    const first = localObjectBlobUrl('lru-0', buf, 'image/png');
    expect(first.startsWith('blob:')).toBe(true);
    // A recent id survives eviction: same URL comes back with no data at all.
    const recent = localObjectBlobUrl('lru-519', undefined, 'image/png');
    expect(recent.startsWith('blob:')).toBe(true);
    expect(revoke).toHaveBeenCalled();
    revoke.mockRestore();
  });

  it('a cache hit refreshes recency (live rows are never evicted)', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const buf = new Uint8Array([2]).buffer;
    const keep = localObjectBlobUrl('mru-keep', buf, 'image/png');
    // Touch it repeatedly while 600 others flow through.
    for (let i = 0; i < 600; i++) {
      localObjectBlobUrl(`mru-${i}`, buf, 'image/png');
      localObjectBlobUrl('mru-keep', undefined, 'image/png');
    }
    expect(localObjectBlobUrl('mru-keep', undefined, 'image/png')).toBe(keep);
    revoke.mockRestore();
  });
});
