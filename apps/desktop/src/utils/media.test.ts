import { describe, it, expect } from 'vitest';
import { resolveMediaUrl, isMediaVideo, isVideoPageUrl, isVideoPost, redgifsIdFromUrl, resolveVideoMime, urlFallbackMime } from './media';

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

  it('maps a bare object id to the /api/objects route, never a bare uuid', () => {
    // A raw uuid in an <img src> fires net::ERR_FILE_NOT_FOUND; the resolver
    // must always expand it to the canonical route (relative in browser dev
    // so the Vite proxy owns it, absolute elsewhere).
    const uuid = 'c9f4ace9-fe25-4c6c-a0fc-cfbc26b02119';
    const out = resolveMediaUrl(uuid);
    expect(out).toContain(`/api/objects/${uuid}`);
    expect(out).not.toBe(uuid);
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

describe('resolveVideoMime', () => {
  it('trusts an explicit video type first', () => {
    expect(resolveVideoMime({ type: 'video/mp4', name: 'clip.jpg' })).toBe('video/mp4');
    expect(resolveVideoMime({ type: 'video/webm;codecs=vp9', name: 'clip' })).toBe('video/webm');
  });

  it('falls back to filename extension when type is empty (Windows/Electron MP4s)', () => {
    expect(resolveVideoMime({ type: '', name: 'clip.mp4' })).toBe('video/mp4');
    expect(resolveVideoMime({ type: null, name: 'clip.MOV' })).toBe('video/quicktime');
    expect(resolveVideoMime({ type: 'application/octet-stream', name: 'clip.webm' })).toBe('video/webm');
    expect(resolveVideoMime({ type: '', name: 'clip.mkv' })).toBe('video/x-matroska');
  });

  it('sniffs magic bytes for extension-less blobs', () => {
    const ftyp = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    expect(resolveVideoMime({ type: '', name: 'blob', bytes: ftyp })).toBe('video/mp4');
    const free = new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65, 0, 0, 0, 0]);
    expect(resolveVideoMime({ type: '', name: 'blob', bytes: free })).toBe('video/mp4');
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(resolveVideoMime({ type: '', name: 'blob', bytes: webm })).toBe('video/webm');
  });

  it('returns null when nothing indicates video', () => {
    expect(resolveVideoMime({ type: '', name: 'photo.jpg' })).toBeNull();
    expect(resolveVideoMime({ type: 'image/jpeg', name: 'photo.mp4' })).toBeNull();
    expect(resolveVideoMime({})).toBeNull();
  });
});

describe('isVideoPost', () => {
  it('trusts explicit video mime and video urls', () => {
    expect(isVideoPost('video/mp4', '/api/objects/abc')).toBe(true);
    expect(isVideoPost(null, 'https://x.com/a.mp4')).toBe(true);
  });

  it('treats empty/generic mime as unknown and uses url + siblings', () => {
    expect(isVideoPost('application/octet-stream', 'magnet:?xt=abc', ['video/mp4'])).toBe(true);
    expect(isVideoPost('', 'urn:sha256:abc', [])).toBe(false);
    expect(isVideoPost(null, 'blob:xyz', ['image/jpeg'])).toBe(false);
  });

  it('lets concrete non-video mime win over hints', () => {
    expect(isVideoPost('image/jpeg', 'blob:xyz', ['video/mp4'])).toBe(false);
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

describe('urlFallbackMime', () => {
  it('keeps an explicit video mime (webm stays webm, not mp4)', () => {
    expect(urlFallbackMime({ kind: 'video', mimeType: 'video/webm', previewUrl: 'https://x/v.webm' })).toBe('video/webm');
  });

  it('falls back to video/mp4 for video-ish items without an explicit mime', () => {
    expect(urlFallbackMime({ kind: 'video', previewUrl: 'vault://f/clip' })).toBe('video/mp4');
    expect(urlFallbackMime({ previewUrl: 'https://x/clip.mp4' })).toBe('video/mp4');
    expect(urlFallbackMime({ isVideo: true, previewUrl: 'https://x/watch/abc' })).toBe('video/mp4');
  });

  it('returns null for images so the server default applies', () => {
    expect(urlFallbackMime({ kind: 'image', mimeType: 'image/png', previewUrl: 'https://x/a.png' })).toBeNull();
    expect(urlFallbackMime({ previewUrl: 'https://x/a.jpg' })).toBeNull();
  });
});
