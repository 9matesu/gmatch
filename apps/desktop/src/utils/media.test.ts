import { describe, it, expect } from 'vitest';
import { resolveMediaUrl, isMediaVideo, isVideoPageUrl, redgifsIdFromUrl } from './media';

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

  it('avatar object refs always resolve absolute (never bare-relative: file:// builds would break)', () => {
    // 1.2.6 stored `/api/objects/<uuid>` refs; every avatar <img> must render
    // them through here so packaged (file://) builds hit the API host.
    const uuid = '11111111-1111-4111-8111-111111111111';
    const out = resolveMediaUrl(`/api/objects/${uuid}`);
    expect(out.startsWith('http')).toBe(true);
    expect(out.endsWith(`/api/objects/${uuid}`)).toBe(true);
    expect(out).not.toContain('file:');
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

  it('ignores hash fragments and query format markers', () => {
    expect(isMediaVideo('https://x.com/a.mp4#t=10')).toBe(true);
    expect(isMediaVideo('https://x.com/a.webm#t=1,5')).toBe(true);
    expect(isMediaVideo('https://x.com/a.jpg#t=10')).toBe(false);
    expect(isMediaVideo('https://i.imgur.com/a?format=mp4')).toBe(true);
    expect(isMediaVideo('https://x.com/a.gifv')).toBe(true);
  });

  it('treats redgifs watch pages as video (server resolves to mp4)', () => {
    expect(isMediaVideo('https://www.redgifs.com/watch/abc123')).toBe(true);
    expect(isMediaVideo('https://redgifs.com/ifr/abc123')).toBe(true);
    // Direct CDN bytes are files, still video via extension
    expect(isMediaVideo('https://media.redgifs.com/abc123.mp4')).toBe(true);
  });
});

describe('isVideoPageUrl / redgifsIdFromUrl', () => {
  it('flags watch pages but not direct files', () => {
    expect(isVideoPageUrl('https://www.redgifs.com/watch/abc123')).toBe(true);
    expect(isVideoPageUrl('https://redgifs.com/ifr/abc123')).toBe(true);
    expect(isVideoPageUrl('https://media.redgifs.com/abc123.mp4')).toBe(false);
    expect(isVideoPageUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isVideoPageUrl('https://youtu.be/abc')).toBe(true);
    expect(isVideoPageUrl('https://example.com/pic.jpg')).toBe(false);
    expect(isVideoPageUrl(null)).toBe(false);
  });

  it('extracts redgifs ids from watch/ifr slugs', () => {
    expect(redgifsIdFromUrl('https://www.redgifs.com/watch/abc123')).toBe('abc123');
    expect(redgifsIdFromUrl('https://redgifs.com/ifr/XYZ789')).toBe('xyz789');
    expect(redgifsIdFromUrl('https://www.redgifs.com/tags/blonde')).toBeNull();
    expect(redgifsIdFromUrl('not a url')).toBeNull();
  });
});
