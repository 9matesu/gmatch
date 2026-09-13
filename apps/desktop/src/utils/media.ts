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
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
}

/**
 * Detects if a URL points to a playable video (.mp4, .webm, .mov, .ogg, or video MIME).
 */
export function isMediaVideo(url?: string | null): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return (
    clean.endsWith('.mp4') ||
    clean.endsWith('.webm') ||
    clean.endsWith('.mov') ||
    clean.endsWith('.ogg') ||
    clean.endsWith('.ogv') ||
    clean.endsWith('.m4v') ||
    clean.endsWith('.mkv') ||
    url.includes('video/') ||
    url.includes('redgifs.com') ||
    (url.includes('twimg.com') && url.includes('.mp4'))
  );
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

