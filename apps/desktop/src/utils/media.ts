"use client";

import { getApiBaseUrl } from './api';
import { logger } from './logger';
import { mediaUrlToCachedFile } from './cacheMedia';

/**
 * Resolves any relative media endpoint (/api/objects/..., /api/lobby/images/...)
 * to a full URL pointing to the API host, while keeping data:, blob:, and external URLs untouched.
 */
export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Reject non-web / local schemes up front so a broken `file://` or
  // `about:`/`javascript:` URL never fires a doomed request (the classic
  // `net::ERR_FILE_NOT_FOUND` on the front page).
  if (/^(file|about|javascript|chrome|chrome-extension|moz-extension|safari-web-extension):/i.test(trimmed)) {
    return '';
  }
  // A bare object id (UUID) is never a URL: treat it as the canonical
  // /api/objects/<id> route, else the browser resolves it relative to the
  // page (net::ERR_FILE_NOT_FOUND on a raw uuid in dev and packaged builds).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    // Browser dev (base '') stays relative so the Vite /api proxy owns it;
    // packaged/electron builds resolve to the absolute API host.
    return base ? `${base}/api/objects/${trimmed}` : `/api/objects/${trimmed}`;
  }
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')
  ) {
    // http(s), data:, blob:, and the privileged local schemes
    // (gmcache://, idle-file://, vault://) pass through untouched.
    return trimmed;
  }
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
}

/**
 * Detects if a URL points to a playable video (.mp4, .webm, .mov, .ogg, or video MIME).
 * Fragment suffixes (#t=) are stripped before extension checks; query markers
 * (?format=mp4) and extension-less redgifs watch/ifr links count as video.
 */
export function isMediaVideo(url?: string | null): boolean {
  if (!url) return false;
  const withoutHash = url.split('#')[0];
  const clean = withoutHash.split('?')[0].toLowerCase();
  if (
    clean.endsWith('.mp4') ||
    clean.endsWith('.webm') ||
    clean.endsWith('.mov') ||
    clean.endsWith('.ogg') ||
    clean.endsWith('.ogv') ||
    clean.endsWith('.m4v') ||
    clean.endsWith('.mkv') ||
    clean.endsWith('.gifv')
  ) {
    return true;
  }
  if (/[?&](format|f|type)=(mp4|webm|video|gifv)\b/i.test(withoutHash)) return true;
  if (isVideoPageUrl(url)) return true;
  return (
    url.includes('video/') ||
    url.includes('redgifs.com') ||
    (url.includes('twimg.com') && url.includes('.mp4'))
  );
}

/**
 * Video *page* URLs (watch/embed pages, not direct media bytes). Uploadable
 * via server-side resolution, and previewed as video placeholders — never
 * fed to <img> as if they were files.
 */
export function isVideoPageUrl(url?: string | null): boolean {
  if (!url) return false;
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return false;
  }
  if (host.includes('redgifs.com')) {
    // Direct CDN bytes (media.redgifs.com/*.mp4) are files, not pages.
    if (host.startsWith('media.')) return false;
    if (/\.(mp4|webm|gif|webp|jpg|jpeg|png)(\?|#|$)/i.test(url)) return false;
    return /\/(watch|ifr)\//.test(path);
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return true;
  if (host.endsWith('vimeo.com')) return true;
  return false;
}

/** Gif id from a redgifs watch/ifr URL slug (server resolves it to HD mp4). */
export function redgifsIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('redgifs.com')) return null;
    const m = parsed.pathname.match(/\/(?:watch|ifr)\/([A-Za-z0-9]+)/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Recovers a video MIME type when `File.type` is empty or unhelpful (MP4s on
 * Windows/Electron routinely report `''`). Trusts an explicit video type
 * first, then the filename extension, then caller-supplied magic bytes.
 * Returns null when nothing indicates video — callers keep prior behavior.
 */
const VIDEO_EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
}

export function resolveVideoMime(opts: {
  type?: string | null
  name?: string | null
  bytes?: Uint8Array | ArrayBuffer | null
}): string | null {
  const t = (opts.type || '').toLowerCase().split(';')[0].trim()
  if (t.startsWith('video/')) return t
  // A concrete non-video type (e.g. image/jpeg) wins over extension guesses;
  // only empty/generic types fall through to extension + magic bytes.
  if (t && t !== 'application/octet-stream' && t !== 'binary/octet-stream') return null
  const bareName = (opts.name || '').split('?')[0].split('#')[0]
  const ext = bareName.includes('.') ? bareName.split('.').pop()!.toLowerCase() : ''
  if (ext && VIDEO_EXT_MIME[ext]) return VIDEO_EXT_MIME[ext]
  const raw = opts.bytes instanceof ArrayBuffer ? new Uint8Array(opts.bytes) : opts.bytes
  if (raw && raw.length >= 8) {
    const tag = String.fromCharCode(raw[4], raw[5], raw[6], raw[7])
    if (tag === 'ftyp' || tag === 'moov' || tag === 'mdat' || tag === 'wide' || tag === 'free') {
      if (tag === 'ftyp' && raw.length >= 12) {
        const sub = String.fromCharCode(raw[8], raw[9], raw[10], raw[11]).toLowerCase()
        if (sub.includes('qt')) return 'video/quicktime'
      }
      return 'video/mp4'
    }
    if (raw.length >= 4 && raw[0] === 0x1a && raw[1] === 0x45 && raw[2] === 0xdf && raw[3] === 0xa3) return 'video/webm'
    if (raw.length >= 4 && raw[0] === 0x4f && raw[1] === 0x67 && raw[2] === 0x67 && raw[3] === 0x53) return 'video/ogg'
  }
  return null
}

/** Reads the first bytes of a File/Blob for magic-byte MIME sniffing. Uses
 * arrayBuffer when available, FileReader otherwise (older webviews/jsdom). */
export async function sniffFileHead(file: Blob, n = 16): Promise<Uint8Array | null> {
  try {
    const sliced = file.slice(0, n)
    const anyBlob = sliced as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
    if (typeof anyBlob.arrayBuffer === 'function') {
      return new Uint8Array(await anyBlob.arrayBuffer())
    }
    const buf = await new Promise<ArrayBuffer | null>((resolve) => {
      try {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as ArrayBuffer) || null)
        reader.onerror = () => resolve(null)
        reader.readAsArrayBuffer(sliced)
      } catch {
        resolve(null)
      }
    })
    return buf ? new Uint8Array(buf) : null
  } catch {
    return null
  }
}

/**
 * Render-time video check (never persisted): true for explicit video MIME or
 * video-ish URLs, and — when the MIME is missing/generic (pre-1.4.7 rows
 * registered as application/octet-stream) — for opaque URLs with any sibling
 * video MIME in the same post group. A concrete non-video MIME still wins.
 */
export function isVideoPost(
  mime?: string | null,
  url?: string | null,
  siblingMimes: Array<string | null | undefined> = [],
): boolean {
  const m = (mime || '').toLowerCase().split(';')[0].trim()
  if (m.startsWith('video/')) return true
  if (isMediaVideo(m || url)) return true
  if (m && m !== 'application/octet-stream' && m !== 'binary/octet-stream') return false
  if (isMediaVideo(url)) return true
  return siblingMimes.some((s) => (s || '').toLowerCase().startsWith('video/'))
}

/**
 * Checks if a string is a Twitter/X status link.
 */
export function isTwitterUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === 'twitter.com' ||
        host === 'www.twitter.com' ||
        host === 'x.com' ||
        host === 'www.x.com' ||
        host === 'vxtwitter.com' ||
        host === 'fxtwitter.com' ||
        host === 'fixupx.com') &&
      parsed.pathname.includes('/status/')
    );
  } catch {
    return false;
  }
}

/**
 * Resolves a Twitter/X URL to a playable direct video MP4 URL or image URL.
 */
export async function resolveTwitterMedia(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (!isTwitterUrl(url)) return null;

    const pathname = parsed.pathname;
    const vxApiUrl = `https://api.vxtwitter.com${pathname}`;

    const res = await fetch(vxApiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // 1. Direct video from media_extended
    const video = data.media_extended?.find(
      (m: { type: string; url?: string }) => m.type === 'video' || m.type === 'gif'
    );
    if (video?.url) {
      return video.url;
    }

    // 2. First media from mediaURLs
    if (Array.isArray(data.mediaURLs) && data.mediaURLs.length > 0) {
      return data.mediaURLs[0];
    }

    return null;
  } catch (err) {
    logger.warn('Failed to resolve Twitter media:', err);
    return null;
  }
}

/**
 * Computes a SHA-256 hex digest of a Blob/File's bytes. Used as a content
 * fingerprint so the server can dedup byte-identical re-uploads by the same
 * owner. Runs on the SubtleCrypto Web API available in browsers + workers.
 */
export async function contentHash(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Downloads media from a given URL to the user's computer.
 */
export async function downloadMedia(url: string, suggestedFilename?: string): Promise<boolean> {
  try {
    const resolved = resolveMediaUrl(url);
    if (!resolved) return false;

    let filename = suggestedFilename;
    if (!filename) {
      const cleanUrl = resolved.split('?')[0];
      filename = cleanUrl.split('/').pop() || 'media';
    }

    let blob: Blob | null = null;
    try {
      const res = await fetch(resolved);
      if (res.ok) {
        blob = await res.blob();
      }
    } catch {
      // Direct link fallback
    }

    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      return true;
    } else {
      const a = document.createElement('a');
      a.href = resolved;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }
  } catch (err) {
    logger.warn('Failed to download media:', err);
    return false;
  }
}

/**
 * Copies an image from a URL to the system clipboard as a PNG image.
 */
export async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    const resolved = resolveMediaUrl(url);
    if (!resolved) return false;

    let blob: Blob;
    if (/^https?:\/\//i.test(resolved)) {
      // Booru/remote bytes die on raw cross-origin fetch (CORS/hotlink);
      // same cache-first ladder as reposts (gmcache -> /px -> direct).
      blob = await mediaUrlToCachedFile(resolved);
    } else {
      const res = await fetch(resolved);
      if (!res.ok) throw new Error('Fetch failed');
      blob = await res.blob();
    }

    let pngBlob = blob;
    if (blob.type !== 'image/png') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const objUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image failed to load'));
        img.src = objUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 400;
      canvas.height = img.naturalHeight || 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (converted) pngBlob = converted;
      }
      URL.revokeObjectURL(objUrl);
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]);
      return true;
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(resolved);
      return true;
    }
    return false;
  } catch (err) {
    logger.warn('Failed to copy image to clipboard:', err);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(resolveMediaUrl(url));
        return true;
      }
    } catch {}
    return false;
  }
}

