import { describe, expect, it, vi } from 'vitest';
import { fileAccepted, plausibleMediaUrl, selectionToFile, urlLooksLikeVideo } from './picker';

const imgFile = (name = 'pic.png', type = 'image/png') => new File(['x'], name, { type });
const vidFile = (name = 'clip.mp4', type = 'video/mp4') => new File(['x'], name, { type });

describe('fileAccepted', () => {
  it('accepts images only when image is in accept', () => {
    expect(fileAccepted(imgFile(), ['image'])).toBe(true);
    expect(fileAccepted(vidFile(), ['image'])).toBe(false);
    expect(fileAccepted(vidFile(), ['image', 'video'])).toBe(true);
  });

  it('accepts videos by extension when MIME is missing', () => {
    expect(fileAccepted(new File(['x'], 'clip.webm', { type: '' }), ['video'])).toBe(true);
    expect(fileAccepted(new File(['x'], 'clip.webm', { type: '' }), ['image'])).toBe(false);
  });

  it('rejects non-media types', () => {
    expect(fileAccepted(new File(['x'], 'doc.pdf', { type: 'application/pdf' }), ['image', 'video'])).toBe(false);
  });
});

describe('plausibleMediaUrl', () => {
  it('accepts http(s), data and blob URLs', () => {
    expect(plausibleMediaUrl('https://x.com/a.png')).toBe(true);
    expect(plausibleMediaUrl('http://x.com/a.png')).toBe(true);
    expect(plausibleMediaUrl('data:image/png;base64,AAA')).toBe(true);
    expect(plausibleMediaUrl('blob:https://x.com/abc')).toBe(true);
  });

  it('rejects other schemes, empty and garbage input', () => {
    expect(plausibleMediaUrl('javascript:alert(1)')).toBe(false);
    expect(plausibleMediaUrl('vault://f/abc')).toBe(false);
    expect(plausibleMediaUrl('   ')).toBe(false);
    expect(plausibleMediaUrl('not a url')).toBe(false);
  });
});

describe('urlLooksLikeVideo', () => {
  it('flags video extensions including query strings', () => {
    expect(urlLooksLikeVideo('https://x.com/a.mp4')).toBe(true);
    expect(urlLooksLikeVideo('https://x.com/a.webm?token=1')).toBe(true);
    expect(urlLooksLikeVideo('https://x.com/a.png')).toBe(false);
  });
});

describe('selectionToFile', () => {
  it('passes file selections through unchanged', async () => {
    const file = imgFile();
    const out = await selectionToFile({ kind: 'file', file, previewUrl: 'blob:x', source: 'upload' });
    expect(out).toBe(file);
  });

  it('fetches URL selections into a named File', async () => {
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blob, { status: 200 })));
    const out = await selectionToFile({ kind: 'url', url: 'https://x.com/a.jpg', name: 'keep.jpg', source: 'browse' });
    expect(out).toBeInstanceOf(File);
    expect(out?.name).toBe('keep.jpg');
    expect(out?.type).toBe('image/jpeg');
    vi.unstubAllGlobals();
  });

  it('returns null (never throws) for unreachable URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const out = await selectionToFile({ kind: 'url', url: 'https://x.com/gone.png', source: 'url' });
    expect(out).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null for empty bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([]), { status: 200 })));
    const out = await selectionToFile({ kind: 'url', url: 'https://x.com/empty.png', source: 'url' });
    expect(out).toBeNull();
    vi.unstubAllGlobals();
  });
});
