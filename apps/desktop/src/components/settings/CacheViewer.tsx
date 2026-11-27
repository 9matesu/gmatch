"use client";

import { useEffect, useState } from 'react';
import { HardDrive, Download } from 'lucide-react';
import { getAllObjects, type StoredObject } from '../../utils/storage';
import { localObjectBlobUrl } from '../../utils/mediaData';
import { vaultPin } from '../../services/vault';

/**
 * Cache viewer: the media this device holds (IndexedDB / vault mirror), newest
 * first. A tile can be pinned to the encrypted vault (durable) with one click.
 * Read-only: it never deletes or re-imports.
 */
export function CacheViewer({ toast }: { toast?: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [rows, setRows] = useState<StoredObject[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void getAllObjects()
      .then((all) => {
        if (!live) return;
        const sorted = all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 60);
        setRows(sorted);
        const map: Record<string, string> = {};
        for (const o of sorted) {
          try { map[o.id] = localObjectBlobUrl(o.id, o.data, o.mime_type) } catch { /* skip */ }
        }
        setUrls(map);
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-retro-fg">
        <HardDrive className="h-4 w-4" /> Cached media ({rows.length})
      </div>
      {loading ? (
        <p className="text-xs text-retro-muted">Reading cache…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-retro-muted">Nothing cached yet.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {rows.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => void pin(urls[o.id] || o.id)}
              title="Save to vault"
              className="group relative aspect-square overflow-hidden rounded-md border border-edge bg-retro-bg"
            >
              <img src={urls[o.id]} alt="" loading="lazy" className="h-full w-full object-cover" />
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