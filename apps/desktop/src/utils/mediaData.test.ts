import { describe, it, expect } from 'vitest';
import { dataUrlToBlob, localObjectBlobUrl } from './mediaData';

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
