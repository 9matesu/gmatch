"use client";

/**
 * B7: the ONE media picker. Browse (idle keepsakes, tag-filterable) /
 * Upload (click, drag-drop, clipboard paste) / URL (paste, preview,
 * validate) — every entry point renders this instead of growing its own
 * input maze. Contract + helpers: ./picker.ts. No new cache: keepsakes
 * render from bytes the vault/gallery already holds, through the SAME
 * resolution pipeline as the gallery (resolveGalleryTileUrl + vault/IDB
 * maps) — a persisted keep is never hotlinked back to its provider.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FolderOpen, Image as ImageIcon, LinkIcon, Loader2, UploadCloud, X } from 'lucide-react';
import { CameraCapture } from '../CameraCapture';
import { useGame } from '../../game/store';
import type { GalleryImage } from '../../game/types';
import { useVaultHttpUrls, useVaultUrls } from '../../services/vault';
import { releaseLocalUrl, resolveFreshLocalUrl } from '../../services/keepsake';
import { resolveGalleryTileUrl, useKeepsakeLocalUrls } from '../grid/IdleGalleryView';
import { resolveContentAddressedMedia } from '../../utils/contentAddressedMedia';
import { registerLocalObject } from '../../utils/p2pSwarm';
import { Button, Input } from '../../ui/kit';
import { COLOR, classes } from '../../ui/tokens';
import {
  fileAccepted,
  plausibleMediaUrl,
  type MediaPickerOptions,
  type MediaSelection,
} from './picker';

type Pane = 'browse' | 'upload' | 'url' | 'camera';

type Pending =
  | { kind: 'url'; url: string; name?: string; source: MediaSelection['source'] }
  | { kind: 'file'; file: File; previewUrl: string; source: MediaSelection['source'] };

/** Small preview surface shared by all panes: img for stills, video for mp4/webm. */
function Preview({ url, isVideo }: { url: string; isVideo: boolean }) {
  if (isVideo) {
    return <video src={url} controls muted playsInline className="max-h-56 w-auto max-w-full rounded-lg bg-retro-bg" />;
  }
  return <img src={url} alt="Selected media preview" className="max-h-56 w-auto max-w-full rounded-lg object-contain bg-retro-bg" />;
}

export function MediaPickerPanel({
  options,
  onPick,
  onClose,
  compact = false,
}: {
  options: MediaPickerOptions;
  onPick: (sel: MediaSelection) => void;
  onClose: () => void;
  /** Bubble mode: tighter paddings, no dialog chrome. */
  compact?: boolean;
}) {
  const accept = options.accept ?? ['image'];
  const sources = options.sources ?? ['browse', 'upload', 'url'];
  const gallery = useGame((s) => s.gallery);

  // Open on Browse (the gallery) whenever it is offered — fewest clicks to a
  // keepsake. Callers that only allow upload/url still open on their first pane.
  const [pane, setPane] = useState<Pane>(sources.includes('browse') ? 'browse' : sources[0]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busyKeepId, setBusyKeepId] = useState<string | null>(null);
  const [selectedKeepId, setSelectedKeepId] = useState<string | null>(null);
  // Browse pane renders a bounded window and grows on demand: mounting every
  // keepsake tile (each a vault-fetched <img>/<video>) at once is what made
  // the gallery lag with a few hundred keeps.
  const PAGE = 24;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Object URL for the current upload preview; revoked on replace/close —
  // EXCEPT after a confirm, when ownership transfers to the caller.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const acceptAttr = [
    ...accept,
    ...(accept.includes('image') ? ['image/*'] : []),
    ...(accept.includes('video') ? ['video/*'] : []),
  ].join(',');

  const takeFile = useCallback(
    (file: File | undefined, source: MediaSelection['source']) => {
      if (!file) return;
      if (!fileAccepted(file, accept)) {
        setError(`That file type isn't accepted here (${accept.join(' or ')} only).`);
        return;
      }
      setError(null);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      objectUrlRef.current = previewUrl;
      setSelectedKeepId(null);
      setPending({ kind: 'file', file, previewUrl, source });
    },
    [accept],
  );

  // Clipboard paste of image/video bytes while the picker is open.
  useEffect(() => {
    if (!sources.includes('upload')) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) {
        e.preventDefault();
        setPane('upload');
        takeFile(file, 'clipboard');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sources, takeFile]);

  const previewUrlInput = () => {
    const url = urlInput.trim();
    if (!plausibleMediaUrl(url)) {
      setError('That is not a usable http(s)/data URL.');
      return;
    }
    if (accept.includes('image') && !accept.includes('video') && /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url)) {
      setError('This caller takes images only — that link looks like a video.');
      return;
    }
    setError(null);
    setSelectedKeepId(null);
    setPending({ kind: 'url', url, source: 'url' });
  };

  // --- Browse pane: the gallery's own keepsake resolution pipeline. -------
  // Hooks stay unconditional; empty inputs make them no-ops when the browse
  // pane is not among the sources.
  const browseGallery = sources.includes('browse') ? gallery : [];
  const vaultUrls = useVaultUrls(browseGallery.map((g) => g.url));
  const localUrls = useKeepsakeLocalUrls(browseGallery, vaultUrls);

  const tileUrlById = useMemo(
    () =>
      new Map(
        browseGallery.map((img) => [
          img.id,
          resolveGalleryTileUrl(img, vaultUrls[img.url || ''] || localUrls[img.url || '']),
        ]),
      ),
    [browseGallery, vaultUrls, localUrls],
  );
  const vaultTileUrls = [...tileUrlById.values()].filter((u): u is string => u.startsWith('vault://'));
  const httpUrlMap = useVaultHttpUrls(vaultTileUrls);
  const tileUrl = (img: GalleryImage): string => {
    const raw = tileUrlById.get(img.id) || '';
    if (raw.startsWith('vault://')) return httpUrlMap[raw] || raw;
    return raw;
  };

  /**
   * Select a keepsake: resolve its LOCAL bytes (vault, else the swarm object
   * store), never its provider URL — an offline or evicted keep says so
   * instead of pretending a hotlink will work. The resolver's URL is
   * released once the bytes are in a File; the vault record is untouched
   * (re-persisting stays the caller's flow, deduped by content hash).
   */
  const pickKeep = async (img: GalleryImage) => {
    if (busyKeepId) return;
    setBusyKeepId(img.id);
    setError(null);
    let fresh: string | null = null;
    let blob: Blob | null = null;
    try {
      fresh = await resolveFreshLocalUrl(img);
      if (!fresh) {
        // The tile already renders these bytes through the SAME local pipeline
        // (vault loopback / IndexedDB blob). What you can see you can post: a
        // display URL that is local IS the local copy — never a provider
        // hotlink, so the fallback stays honest.
        const display = tileUrl(img);
        const isLocalDisplay =
          /^(blob:|data:)/i.test(display) ||
          /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/i.test(display);
        if (isLocalDisplay) fresh = display;
      }
      if (fresh) {
        const res = await fetch(fresh);
        if (res.ok) blob = await res.blob();
      }
      // Auto-fetch from the swarm when THIS device holds no local copy yet. A
      // keepsake is addressed by its content hash, so any peer holding the
      // bytes can serve them now — the player never has to open the Gallery
      // first to "fetch" what the picker can fetch itself.
      if (!blob || !blob.size) {
        const hash = img.localRef && /^[0-9a-f]{64}$/i.test(img.localRef) ? img.localRef : null;
        if (hash) {
          const fetched = await resolveContentAddressedMedia(null, hash);
          if (fetched && fetched.size) {
            try { registerLocalObject(hash, fetched); } catch { /* seed best-effort */ }
            blob = fetched;
          }
        }
      }
      if (!blob || !blob.size) {
        setError('No local copy of this keepsake on this device yet, and no peer answered. Keep a seeder online and try again.');
        return;
      }
      const mime = blob.type || 'application/octet-stream';
      const ext = (mime.split('/')[1] || 'jpg').split('+')[0] || 'jpg';
      const file = new File([blob], `keep-${img.id.slice(0, 8)}.${ext}`, { type: mime });
      if (!fileAccepted(file, accept)) {
        setError(`That keepsake doesn't fit this picker (${accept.join(' or ')} only).`);
        return;
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const previewUrl = URL.createObjectURL(blob);
      objectUrlRef.current = previewUrl;
      setSelectedKeepId(img.id);
      setPending({ kind: 'file', file, previewUrl, source: 'browse' });
    } catch {
      setError('The local copy of that keepsake could not be read. Open it in the Gallery to repair it first.');
    } finally {
      // The picker consumed the bytes; the resolver's URL is no longer ours.
      if (fresh) releaseLocalUrl(fresh);
      setBusyKeepId(null);
    }
  };

  const filteredGallery = browseGallery
    // Respect the caller's accepted kinds: video keepsakes only show when the
    // caller actually takes video (kind comes from the captured post).
    .filter((g) => (accept.includes('video') ? true : g.kind !== 'video'))
    .filter((g) =>
      tagFilter.trim() ? g.tags.some((t) => t.toLowerCase().includes(tagFilter.trim().toLowerCase())) : true,
    );
  const shownGallery = filteredGallery.slice(0, visibleCount);

  const confirm = () => {
    if (!pending) return;
    // The caller now owns the preview URL — the unmount cleanup must not
    // revoke what was just handed over.
    if (pending.kind === 'file') objectUrlRef.current = null;
    onPick(pending);
  };

  const tabBtn = (p: Pane, label: string, Icon: typeof FolderOpen) => (
    <Button
      key={p}
      variant={pane === p ? 'secondary' : 'ghost'}
      size="sm"
      onClick={() => {
        setPane(p);
        setError(null);
      }}
      className={classes('rounded-full', pane === p && COLOR.glassW12)}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </Button>
  );

  return (
    <div
      aria-label={options.title ?? 'Pick media'}
      // A FIXED footprint, not a content-sized box: the balloon keeps the same
      // width and height on every pane, so switching tabs never resizes it or
      // moves the controls under the pointer. The body is the only part that
      // scrolls.
      className={`bg-surface-raised border border-edge rounded-xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden text-retro-fg ${
        compact
          ? 'h-[420px] max-h-(--max-h-sheet) text-xs'
          : 'h-[560px] max-h-(--max-h-panel)'
      }`}
    >
      <div className={`flex items-center justify-between ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} border-b border-edge`}>
        <h2 className="text-base font-black tracking-tight">{options.title ?? 'Pick media'}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close media picker"
          className="p-1"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className={`flex items-center gap-1.5 ${compact ? 'px-3 py-1.5' : 'px-4 py-2'} border-b border-edge`}>
        {sources.includes('browse') && tabBtn('browse', 'Your media', FolderOpen)}
        {sources.includes('upload') && tabBtn('upload', 'Upload', UploadCloud)}
        {sources.includes('url') && tabBtn('url', 'Paste URL', LinkIcon)}
        {sources.includes('camera') && tabBtn('camera', 'Camera', Camera)}
      </div>

      <div className={`flex-1 overflow-y-auto ${compact ? 'p-3' : 'p-4'} space-y-3 styled-scrollbar`}>
        {error && (
          <p className="text-xs font-bold text-retro-error" role="alert">
            {error}
          </p>
        )}

        {pane === 'browse' && (
          browseGallery.length === 0 ? (
            <p className="text-xs text-retro-muted py-6 text-center">
              Your gallery is empty — upload a file or paste a URL instead.
            </p>
          ) : (
            <>
              <Input
                type="text"
                value={tagFilter}
                onChange={(e) => {
                  setTagFilter(e.target.value);
                  setVisibleCount(PAGE);
                }}
                placeholder="Filter by tag…"
              />
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {shownGallery.map((g: GalleryImage) => {
                    const video = g.kind === 'video';
                    const selected = selectedKeepId === g.id && pending?.kind === 'file' && pending.source === 'browse';
                    const src = tileUrl(g);
                    const raw = tileUrlById.get(g.id) || '';
                    // No local bytes and no preview: an empty tile is honest.
                    const unresolvable = !src;
                    return (
                      <Button
                        key={g.id}
                        variant={busyKeepId === g.id ? 'primary' : 'secondary'}
                        size="md"
                        onClick={() => void pickKeep(g)}
                        className="relative aspect-square w-full overflow-hidden p-0"
                        title={unresolvable ? 'No local copy yet' : g.tags?.join(', ')}
                        disabled={unresolvable || busyKeepId === g.id}
                      >
                        {busyKeepId === g.id ? (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-5 h-5 animate-spin text-retro-accent" />
                          </span>
                        ) : unresolvable ? (
                          <span className="absolute inset-0 flex items-center justify-center text-2xs text-retro-muted">No local copy</span>
                        ) : video ? (
                          <video src={src} muted preload="metadata" className="w-full h-full object-cover" />
                        ) : (
                          <img
                            src={src}
                            alt={g.tags?.[0] || 'keepsake'}
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.opacity = '0.15';
                            }}
                          />
                        )}
                        {selected && (
                          <span className="absolute inset-0 bg-retro-accent/20 flex items-center justify-center">
                            <ImageIcon className="w-5 h-5 text-retro-fg drop-shadow" />
                          </span>
                        )}
                        {raw.startsWith('vault://') && !httpUrlMap[raw] && !unresolvable && (
                          <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-2xs bg-black/60 text-retro-fg/80">…</span>
                        )}
                      </Button>
                    );
                  })}
                </div>
                {filteredGallery.length > shownGallery.length && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setVisibleCount((c) => c + PAGE)}
                    className="w-full"
                  >
                    Load more ({filteredGallery.length - shownGallery.length} left)
                  </Button>
                )}
                {filteredGallery.length === 0 && (
                  <p className="text-xs text-retro-muted text-center">No keepsakes match that tag.</p>
                )}
              </>
            )
          )}

          {pane === 'upload' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                takeFile(e.dataTransfer.files?.[0], 'upload');
              }}
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer text-center transition ${
                dragOver ? 'border-retro-accent bg-glass-w10' : 'border-edge hover:border-retro-accent bg-surface-interactive'
              }`}
            >
              <UploadCloud className="w-7 h-7 text-retro-muted" />
              <p className="text-xs font-bold text-retro-body">Drop a file, click to browse, or paste from the clipboard</p>
              <span className="text-2xs text-retro-muted">{accept.join(' or ')}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptAttr}
                className="hidden"
                onChange={(e) => {
                  takeFile(e.target.files?.[0], 'upload');
                  e.currentTarget.value = '';
                }}
              />
            </div>
          )}

          {pane === 'url' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      previewUrlInput();
                    }
                  }}
                  placeholder="https://…"
                  className="flex-1"
                />
                <Button variant="primary" size="sm" onClick={previewUrlInput}>
                  Preview
                </Button>
              </div>
              <p className="text-2xs text-retro-muted">The media is previewed before it is attached — broken links are caught here.</p>
            </div>
          )}

          {pane === 'camera' && (
            <CameraCapture
              onCapture={(file) => { takeFile(file, 'camera'); setPane('upload'); }}
              onCancel={() => setPane(sources.includes('browse') ? 'browse' : 'upload')}
            />
          )}

          {pending && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-center border border-edge rounded-xl bg-glass-w5 p-2">
                <Preview url={pending.kind === 'file' ? pending.previewUrl : pending.url} isVideo={pending.kind === 'file' ? fileAccepted(pending.file, ['video']) && !fileAccepted(pending.file, ['image']) : /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(pending.url)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedKeepId(null);
                    setPending(null);
                  }}
                >
                  Clear
                </Button>
                <Button variant="primary" size="sm" onClick={confirm}>
                  Use this media
                </Button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * The modal wrapper: fixed overlay + dialog semantics around the SAME panel
 * the navbar bubble renders inline. All picker behaviour lives in
 * MediaPickerPanel — this adds only the backdrop and the close-on-backdrop.
 */
export function MediaPickerModal({
  options,
  onPick,
  onClose,
}: {
  options: MediaPickerOptions;
  onPick: (sel: MediaSelection) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[var(--z-picker)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={options.title ?? 'Pick media'} className="contents">
        <MediaPickerPanel options={options} onPick={onPick} onClose={onClose} />
      </div>
    </div>
  );
}

/**
 * Promise-based handle: `const sel = await open(); if (!sel) return;`
 * Render `picker` once next to the caller's other modals.
 *
 * Lifecycle: a pending promise is always settled — a newer open() supersedes
 * it with null, and unmount settles it too, so no caller ever awaits forever.
 */
export function useMediaPicker(options: MediaPickerOptions) {
  const [open_, setOpen_] = useState(false);
  const resolverRef = useRef<((sel: MediaSelection | null) => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const settle = useCallback((sel: MediaSelection | null) => {
    resolverRef.current?.(sel);
    resolverRef.current = null;
    setOpen_(false);
  }, []);

  const open = useCallback(() => {
    return new Promise<MediaSelection | null>((resolve) => {
      // A second invocation while the picker is open cancels the first
      // request — two callers can never race over one selection.
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setOpen_(true);
    });
  }, []);

  // Unmount (the whole caller closed) still settles a pending promise.
  useEffect(() => {
    return () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    };
  }, []);

  const picker = open_ ? (
    <MediaPickerModal options={optionsRef.current} onPick={settle} onClose={() => settle(null)} />
  ) : null;

  return { open, picker };
}
