"use client";

import { mediaUrlToCachedFile } from '../utils/cacheMedia';
import { registerLocalObject, getLocalObject, sha256HexBlob } from '../utils/p2pSwarm';
import { vaultPin, vaultGet } from './vault';
import type { GalleryImage } from '../game/types';

export interface KeepsakePersistResult {
  status: 'local' | 'failed';
  hash?: string;
  bytes?: number;
  /** Which durable store holds the verified bytes. */
  via?: 'idb' | 'vault-stream';
  reason?: string;
}

export interface KeepsakeDeps {
  fetchFile: (url: string) => Promise<File>;
  storeBytes: (key: string, file: File) => void;
  readBack: (key: string) => Promise<Blob | null>;
  hash: (blob: Blob) => Promise<string>;
  pin: (url: string) => Promise<string | null>;
  /** Streaming vault pin (Electron, large video): chunked to disk, hashed
   *  incrementally, quota-enforced. Null when no bridge (dev). */
  pinStream: (url: string) => Promise<{
    ok: boolean; key?: string; mime?: string; bytes?: number; hash?: string; reason?: string;
  } | null>;
  vaultReadBack: (url: string) => Promise<string | null>;
}

function bridge(): {
  vaultPinStream?: (url: string) => Promise<{
    ok: boolean; key?: string; mime?: string; bytes?: number; hash?: string; reason?: string;
  }>;
} | null {
  try {
    if (typeof window === 'undefined') return null;
    const g = (window as unknown as { gmatch?: unknown }).gmatch as Record<string, unknown> | undefined;
    return g && typeof g.vaultPinStream === 'function' ? g as never : null;
  } catch {
    return null;
  }
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv)(?:[?#]|$)/i;

const defaultDeps: KeepsakeDeps = {
  fetchFile: mediaUrlToCachedFile,
  storeBytes: (key, file) => registerLocalObject(key, file),
  readBack: (key) => getLocalObject(key),
  hash: (blob) => sha256HexBlob(blob),
  pin: (url) => vaultPin(url),
  pinStream: (url) => {
    const b = bridge();
    return b?.vaultPinStream ? b.vaultPinStream(url) : Promise.resolve(null);
  },
  vaultReadBack: (url) => vaultGet(url),
};

/**
 * Phase 5 local-first keepsake: a Clicker keep is only "saved" once its
 * bytes are fetched, verified present in durable local storage, hashed,
 * and (best-effort) pinned to the vault. External URLs are import
 * sources only — never the authoritative source of a saved item.
 *
 * Two durable routes, no arbitrary per-file cap:
 * - images/small media: fetch whole file -> validate -> hash -> IndexedDB
 *   (registerLocalObject) -> read-back verify. Works in dev and packaged.
 * - video (or when the whole-file route cannot run): streaming vault pin in
 *   the main process (chunked disk writes, incremental hash, quota the only
 *   limit) -> vault read-back verify. Electron only; dev falls back to the
 *   whole-file route and honestly fails past browser quota.
 *
 * Returns 'failed' (never throws) so the caller can keep the source url as
 * retryable import metadata instead of pretending the item is cached.
 */
export async function persistKeepsake(
  url: string,
  deps: Partial<KeepsakeDeps> = {},
  kind?: 'image' | 'video',
): Promise<KeepsakePersistResult> {
  const d = { ...defaultDeps, ...deps };
  if (!url) return { status: 'failed', reason: 'no-url' };
  const looksVideo = kind === 'video' || VIDEO_EXT.test(url);
  // Videos go straight to the streaming vault route (no full-memory buffer,
  // no image-oriented byte ceiling); images keep the whole-file route.
  if (looksVideo) {
    const streamed = await persistKeepsakeStreamed(url, d);
    if (streamed) return streamed;
    // Streaming unavailable/failed: fall through to the whole-file route,
    // which honestly fails past its caps rather than pretending success.
  }
  try {
    // 1. Obtain real bytes (type/size validated inside mediaUrlToCachedFile).
    const file = await d.fetchFile(url);
    if (!file || file.size === 0) return { status: 'failed', reason: 'empty' };
    const mime = file.type || '';
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      return { status: 'failed', reason: 'not-media' };
    }
    // 2. Content hash (verification + swarm alias).
    const hash = await d.hash(file);
    // 3. Persist durable bytes keyed by source url AND by hash.
    d.storeBytes(url, file);
    d.storeBytes(hash, file);
    // 4. Read back and verify the object is actually retrievable.
    const back = await d.readBack(url);
    if (!back || back.size !== file.size) return { status: 'failed', reason: 'readback' };
    // 5. Vault pin is best-effort (Electron stores bytes; dev degrades).
    try {
      await d.pin(url);
    } catch {
      /* vault optional — IndexedDB copy already durable */
    }
    return { status: 'local', hash, bytes: file.size, via: 'idb' };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : 'fetch' };
  }
}

/** Streaming route: vault chunks + hashes on disk; verify by read-back. */
async function persistKeepsakeStreamed(
  url: string,
  d: KeepsakeDeps,
): Promise<KeepsakePersistResult | null> {
  let res: Awaited<ReturnType<KeepsakeDeps['pinStream']>>;
  try {
    res = await d.pinStream(url);
  } catch {
    return null;
  }
  if (!res || !res.ok || !res.bytes || res.bytes === 0 || !res.hash) {
    // null = no bridge (dev): let the caller try the whole-file route.
    // { ok:false } = the vault refused: quota/disk/fetch — terminal here.
    if (!res) return null;
    return { status: 'failed', reason: res.reason || 'vault' };
  }
  // Read-back: the vault lookup only resolves when the file is on disk.
  const local = await d.vaultReadBack(url).catch(() => null);
  if (!local) return { status: 'failed', reason: 'readback' };
  return { status: 'local', hash: res.hash, bytes: res.bytes, via: 'vault-stream' };
}

/** Loopback http(s): the Electron vault server. The only remote-looking
 *  URL that still counts as local bytes. */
function isLoopbackHttp(u: string): boolean {
  try {
    const parsed = new URL(u)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

/** A resolved value only counts when it is not the source itself and not a
 *  non-loopback remote URL. Self-mappings (legacy dev vault fallback) and
 *  provider URLs are never proof of local bytes. */
function isLocalValue(v: string | undefined, sourceKey: string): v is string {
  if (!v || v === sourceKey) return false
  if (/^(gmcache|idle-file|vault|blob|data):/i.test(v)) return true
  return isLoopbackHttp(v)
}

/**
 * Fresh local resolution at action time (open/download): vault lookup first,
 * then the durable object store, minting a blob URL only from verified bytes.
 * Never returns the provider URL. Blob URLs are session-scoped; callers that
 * hand them to a new tab keep them alive (same rule as CardZoomModal).
 */
export async function resolveFreshLocalUrl(
  img: Pick<GalleryImage, 'url' | 'kind' | 'localStatus' | 'localHash'>,
): Promise<string | null> {
  const key = img.url || ''
  if (!key) return null
  if (img.localStatus === 'failed') return null
  try {
    const { vaultGet } = await import('./vault')
    const v = await vaultGet(key).catch(() => null)
    if (v && isLocalValue(v, key)) return v
  } catch { /* fall through to the object store */ }
  try {
    const blob = (await getLocalObject(key)) || (img.localHash ? await getLocalObject(img.localHash) : null)
    if (blob && blob.size > 0) return URL.createObjectURL(blob)
  } catch { /* unresolved */ }
  return null
}

/**
 * The single local-only resolver for keepsakes (images AND video). Returns
 * either a verified local media URL/reference or an explicit missing state —
 * NEVER the original remote URL.
 */
export type KeepsakeLocal =
  | { kind: 'local'; url: string; media: 'image' | 'video' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'missing'; legacy: boolean };

export function resolveKeepsakeLocal(
  img: Pick<GalleryImage, 'url' | 'kind' | 'localStatus'>,
  vaultUrls: Record<string, string>,
  localUrls: Record<string, string>,
): KeepsakeLocal {
  const media = img.kind === 'video' ? 'video' : 'image';
  const key = img.url || '';
  const v = key ? vaultUrls[key] || localUrls[key] : undefined;
  if (isLocalValue(v, key)) return { kind: 'local', url: v, media };
  switch (img.localStatus) {
    case 'pending':
      return { kind: 'pending' };
    case 'failed':
      return { kind: 'failed' };
    case 'local':
      // Claimed local but bytes are gone (evicted vault / cleared store).
      return { kind: 'missing', legacy: false };
    default:
      // Legacy record: never verified, recovery not yet attempted.
      return { kind: 'missing', legacy: true };
  }
}
