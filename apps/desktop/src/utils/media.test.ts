import { describe, it, expect } from 'vitest';
import { resolveMediaUrl, isMediaVideo } from './media';

describe('resolveMediaUrl', () => {
  it('keeps data:, blob:, http: and https: URLs untouched', () => {
    expect(resolveMediaUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveMediaUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    expect(resolveMediaUrl('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
    expect(resolveMediaUrl('http://example.com/x.jpg')).toBe('http://example.com/x.jpg');
  });

  it('rejects local and non-web schemes so broken requests never fire', () => {
    expect(resolveMediaUrl('file:///C:/x.jpg')).toBe('');
    expect(resolveMediaUrl('about:blank')).toBe('');
    expect(resolveMediaUrl('javascript:alert(1)')).toBe('');
    expect(resolveMediaUrl('chrome-extension://abc')).toBe('');
  });

  it('resolves relative /api paths to the API base', () => {
    const out = resolveMediaUrl('/api/objects/abc');
    expect(out).toContain('/api/objects/abc');
    expect(out.startsWith('http')).toBe(true);
  });

  it('returns empty for empty or missing input', () => {
    expect(resolveMediaUrl('')).toBe('');
    expect(resolveMediaUrl(null)).toBe('');
    expect(resolveMediaUrl(undefined)).toBe('');
  });
});

describe('isMediaVideo', () => {
  it('detects common video extensions', () => {
    expect(isMediaVideo('https://x.com/a.mp4')).toBe(true);
    expect(isMediaVideo('https://x.com/a.webm')).toBe(true);
    expect(isMediaVideo('https://x.com/a.jpg')).toBe(false);
  });
});
