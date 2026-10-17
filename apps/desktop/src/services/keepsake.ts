"use client";

import { mediaUrlToCachedFile } from '../utils/cacheMedia';
import { registerLocalObject, getLocalObject, sha256HexBlob } from '../utils/p2pSwarm';
import { vaultPin, vaultGet } from './vault';
import type { GalleryImage } from '../game/types';

export interface KeepsakePersistResult {
  status: 'local' | 'failed';
  /** sha256 of the stored bytes = the keep's single local identity.
   *  vault://f/<ref>, object_id of the swarm, vault lookup key. */
  ref?: string;
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
    return { status: 'local', ref: hash, bytes: file.size, via: 'idb' };
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
  return { status: 'local', ref: res.hash, bytes: res.bytes, via: 'vault-stream' };
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
 * Blob-URL ownership for `resolveFreshLocalUrl`.
 *
 * A minted `blob:` URL lives as long as the document that created it, and
 * nothing tells us when a consumer is done with it. Two explicit contracts,
 * no timers (a timer would break video range requests mid-seek):
 *
 * - synchronous consumers (downloads) release the URL when they finish, via
 *   `releaseLocalUrl` in a `finally` (success AND failure);
 * - a URL handed to a context we cannot observe (a new tab) is claimed with
 *   `retainLocalUrl`. The cap below NEVER reaps a claimed URL, because the
 *   consuming tab keeps requesting it. Claimed URLs are therefore bounded by
 *   the creating document's lifetime (the gallery view), not by the cap.
 *
 * The cap exists to reap URLs nobody claimed, which is the leak: a minted URL
 * whose synchronous consumer already returned and never released it.
 */
const MAX_LIVE_LOCAL_URLS = 4
const liveLocalUrls: string[] = []
const claimedLocalUrls = new Set<string>()

function trackLocalUrl(url: string): void {
  liveLocalUrls.push(url)
  while (liveLocalUrls.length > MAX_LIVE_LOCAL_URLS) {
    // Never reap the URL being handed to the caller right now, and never a
    // claimed one: both are still in use.
    const i = liveLocalUrls.findIndex((u) => u !== url && !claimedLocalUrls.has(u))
    if (i < 0) break
    const [victim] = liveLocalUrls.splice(i, 1)
    try { URL.revokeObjectURL(victim) } catch { /* already gone */ }
  }
}

/**
 * Claim a minted URL for a context we cannot observe (new tab): the cap will
 * not revoke it, and no caller releases it. Idempotent; ignores empty values.
 */
export function retainLocalUrl(url: string): void {
  if (url) claimedLocalUrls.add(url)
}

/**
 * A synchronous consumer is done with the URL: revoke it now. Only revokes
 * URLs this module minted (ownership), so an unknown or provider URL passed
 * by mistake is untouched, and a second release is a no-op. Never throws.
 */
export function releaseLocalUrl(url: string): void {
  if (!url) return
  const i = liveLocalUrls.indexOf(url)
  const known = i >= 0 || claimedLocalUrls.has(url)
  if (i >= 0) liveLocalUrls.splice(i, 1)
  claimedLocalUrls.delete(url)
  if (!known) return
  try { URL.revokeObjectURL(url) } catch { /* already revoked */ }
}

/** Test seam: revoke everything held and forget the registry. */
export function _resetLocalUrls(): void {
  for (const u of liveLocalUrls) {
    try { URL.revokeObjectURL(u) } catch { /* already gone */ }
  }
  liveLocalUrls.length = 0
  claimedLocalUrls.clear()
}

/** Outcome of resolving one keep's locally held bytes. `absent` means the
 *  lookup completed and found nothing; `unreadable` means bytes are known to
 *  be local but could not be read or decrypted. The two are never conflated. */
export type LocalMedia =
  | { state: 'local'; url: string }
  | { state: 'absent' }
  | { state: 'unreadable'; reason: string }

/**
 * Fresh local resolution at action time (view/open/download): the vault by
 * content ref first (the keep's own identity), then by source url (legacy
 * entries indexed by url), then the durable object store. A vault:// hit is
 * handed out as a browser-playable loopback URL -- raw vault:// depends on the
 * Electron custom-scheme handler. Never returns the provider URL. Minted blob
 * URLs are registered for ownership (`releaseLocalUrl` / `retainLocalUrl`).
 */
export async function resolveLocalMedia(
  img: Pick<GalleryImage, 'url' | 'kind' | 'localRef'>,
): Promise<LocalMedia> {
  const key = img.url || ''
  const byRef = img.localRef ? `vault://f/${img.localRef}` : ''
  if (!key && !byRef) return { state: 'absent' }
  let unreadable: string | undefined
  try {
    const { vaultProbe, vaultHttpUrl } = await import('./vault')
    for (const candidate of [byRef, key]) {
      if (!candidate) continue
      const hit = await vaultProbe(candidate)
      if (hit.state === 'unreadable') {
        unreadable = hit.reason
        continue
      }
      if (hit.state !== 'local') continue
      const url = hit.local.startsWith('vault://')
        ? (await vaultHttpUrl(hit.local)) || hit.local
        : hit.local
      if (isLocalValue(url, key)) return { state: 'local', url }
    }
  } catch { /* vault unavailable: fall through to the object store */ }
  try {
    const blob =
      (img.localRef ? await getLocalObject(img.localRef) : null) ||
      (key ? await getLocalObject(key) : null)
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob)
      trackLocalUrl(url)
      return { state: 'local', url }
    }
  } catch { /* unresolved */ }
  return unreadable ? { state: 'unreadable', reason: unreadable } : { state: 'absent' }
}

/**
 * Fresh local resolution at action time (open/download): the viewer's resolver,
 * minus the two cases where handing out a URL would be wrong -- a record with
 * no source url, and one already known to have failed to persist.
 */
export async function resolveFreshLocalUrl(
  img: Pick<GalleryImage, 'url' | 'kind' | 'saveState' | 'localRef'>,
): Promise<string | null> {
  if (!img.url) return null
  if (img.saveState === 'failed') return null
  const r = await resolveLocalMedia(img)
  return r.state === 'local' ? r.url : null
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
  img: Pick<GalleryImage, 'url' | 'kind' | 'saveState'>,
  vaultUrls: Record<string, string>,
  localUrls: Record<string, string>,
): KeepsakeLocal {
  const media = img.kind === 'video' ? 'video' : 'image';
  const key = img.url || '';
  const v = key ? vaultUrls[key] || localUrls[key] : undefined;
  if (isLocalValue(v, key)) return { kind: 'local', url: v, media };
  switch (img.saveState) {
    case 'downloading':
      return { kind: 'pending' };
    case 'failed':
      return { kind: 'failed' };
    case 'persisted':
      // Claimed persisted but bytes are gone (evicted vault / cleared store).
      return { kind: 'missing', legacy: false };
    default:
      // Legacy record: never verified, recovery not yet attempted.
      return { kind: 'missing', legacy: true };
  }
}
