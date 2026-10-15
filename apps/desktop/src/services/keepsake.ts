"use client";

import { mediaUrlToCachedFile } from '../utils/cacheMedia';
import { registerLocalObject, getLocalObject, sha256HexBlob } from '../utils/p2pSwarm';
import { vaultPin } from './vault';

export interface KeepsakePersistResult {
  status: 'local' | 'failed';
  hash?: string;
  reason?: string;
}

export interface KeepsakeDeps {
  fetchFile: (url: string) => Promise<File>;
  storeBytes: (key: string, file: File) => void;
  readBack: (key: string) => Promise<Blob | null>;
  hash: (blob: Blob) => Promise<string>;
  pin: (url: string) => Promise<string | null>;
}

const defaultDeps: KeepsakeDeps = {
  fetchFile: mediaUrlToCachedFile,
  storeBytes: (key, file) => registerLocalObject(key, file),
  readBack: (key) => getLocalObject(key),
  hash: (blob) => sha256HexBlob(blob),
  pin: (url) => vaultPin(url),
};

/**
 * Phase 5 local-first keepsake: a Clicker keep is only "saved" once its
 * bytes are fetched, verified present in the durable local object store,
 * hashed, and (best-effort) pinned to the vault. External URLs are import
 * sources only — never the authoritative source of a saved item.
 *
 * Returns 'failed' (never throws) so the caller can keep the source url as
 * retryable import metadata instead of pretending the item is cached.
 */
export async function persistKeepsake(
  url: string,
  deps: Partial<KeepsakeDeps> = {},
): Promise<KeepsakePersistResult> {
  const d = { ...defaultDeps, ...deps };
  if (!url) return { status: 'failed', reason: 'no-url' };
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
    return { status: 'local', hash };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : 'fetch' };
  }
}
