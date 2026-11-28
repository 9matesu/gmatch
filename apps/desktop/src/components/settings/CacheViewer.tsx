"use client";

import { useEffect, useState } from 'react';
import { HardDrive, Download } from 'lucide-react';
import { sha256Hex } from '@orbit/protocol';
import { getAllObjects, type StoredObject } from '../../utils/storage';
import { localObjectBlobUrl } from '../../utils/mediaData';
import { vaultPin } from '../../services/vault';

/** Bounded window: a dense grid must not mount the whole cache at once. */
const MAX_VISIBLE = 60;

/**
 * One tile per picture, newest first. Media is seeded under BOTH its object id
 * and its content hash, so byte-identical rows used to render twice; rows with
 * no resolvable bytes produced dead thumbnails. Both are dropped here, before
 * any URL is minted, so the count is exactly the tiles shown.
 */
export function selectCacheRows(all: StoredObject[]): { rows: StoredObject[]; urls: Record<string, string> } {
  const seen = new Set<string>();
  const rows: StoredObject[] = [];
  const urls: Record<string, string> = {};
  const sorted = [...all].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  for (const o of sorted) {
    if (!o?.id || !o.data || o.data.byteLength === 0) continue;
    const hash = sha256Hex(new Uint8Array(o.data));
    if (seen.has(hash)) continue;
    const url = localObjectBlobUrl(o.id, o.data, o.mime_type);
    if (!url) continue;
    seen.add(hash);
    rows.push(o);
    urls[o.id] = url;
    if (rows.length >= MAX_VISIBLE) break;
  }
  return { rows, urls };
}

/**
 * Cache viewer: the media this device holds (IndexedDB / vault mirror), newest
 * first. A tile can be pinned to the encrypted vault (durable) with one click.
 * Read-only: it never deletes or re-imports.
 */
export function CacheViewer({ toast }: { toast?: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [rows, setRows] = useState<StoredObject[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void getAllObjects()
      .then((all) => {
        if (!live) return;
        const selected = selectCacheRows(all);
        setRows(selected.rows);
        setUrls(selected.urls);
        setLoading(false);
      })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const pin = async (src: string) => {
    try {
      await vaultPin(src);
      toast?.('Saved to vault', 'success');
    } catch {
      toast?.('Could not save to vault', 'error');
    }
  };

  // Bytes that exist but are not decodable still fail at paint time; hide the
  // tile instead of leaving a broken image behind.
  const visible = rows.filter((o) => !dead.has(o.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-retro-fg">
        <HardDrive className="h-4 w-4" /> Cached media ({visible.length})
      </div>
      {loading ? (
        <p className="text-xs text-retro-muted">Reading cache…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-retro-muted">Nothing cached yet.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {visible.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => void pin(urls[o.id] || o.id)}
              title="Save to vault"
              aria-label={`Save to vault: ${o.name || o.id}`}
              className="group relative aspect-square overflow-hidden rounded-md border border-edge bg-retro-bg"
            >
              <img
                src={urls[o.id]}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() => setDead((prev) => new Set(prev).add(o.id))}
              />
              <span className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
                <Download className="h-4 w-4 text-white" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
