"use client";

/**
 * B7: the ONE media picker. Browse (idle keepsakes, tag-filterable) /
 * Upload (click, drag-drop, clipboard paste) / URL (paste, preview,
 * validate) — every entry point renders this instead of growing its own
 * input maze. Contract + helpers: ./picker.ts. No new cache: keepsakes
 * render from bytes the vault/gallery already holds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Image as ImageIcon, LinkIcon, UploadCloud, X } from 'lucide-react';
import { useGame } from '../../game/store';
import type { GalleryImage } from '../../game/types';
import {
  fileAccepted,
  plausibleMediaUrl,
  urlLooksLikeVideo,
  type MediaPickerOptions,
  type MediaSelection,
} from './picker';

type Pane = 'browse' | 'upload' | 'url';

type Pending =
  | { kind: 'url'; url: string; name?: string; source: MediaSelection['source'] }
  | { kind: 'file'; file: File; previewUrl: string; source: MediaSelection['source'] };

function keepIsVideo(url: string): boolean {
  return urlLooksLikeVideo(url);
}

/** Small preview surface shared by all panes: img for stills, video for mp4/webm. */
function Preview({ url, isVideo }: { url: string; isVideo: boolean }) {
  if (isVideo) {
    return <video src={url} controls muted playsInline className="max-h-56 w-auto max-w-full rounded-lg bg-black" />;
  }
  return <img src={url} alt="Selected media preview" className="max-h-56 w-auto max-w-full rounded-lg object-contain bg-black" />;
}

export function MediaPickerModal({
  options,
  onPick,
  onClose,
}: {
  options: MediaPickerOptions;
  onPick: (sel: MediaSelection) => void;
  onClose: () => void;
}) {
  const accept = options.accept ?? ['image'];
  const sources = options.sources ?? ['browse', 'upload', 'url'];
  const gallery = useGame((s) => s.gallery);

  const [pane, setPane] = useState<Pane>(sources[0]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Object URL for the current upload preview; revoked on replace/close.
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
    if (accept.includes('image') && !accept.includes('video') && urlLooksLikeVideo(url)) {
      setError('This caller takes images only — that link looks like a video.');
      return;
    }
    setError(null);
    setPending({ kind: 'url', url, source: 'url' });
  };

  const filteredGallery = gallery
    // Respect the caller's accepted kinds: video-looking keepsakes only show
    // when the caller actually takes video.
    .filter((g) => (accept.includes('video') ? true : !keepIsVideo(g.url)))
    .filter((g) =>
      tagFilter.trim() ? g.tags.some((t) => t.toLowerCase().includes(tagFilter.trim().toLowerCase())) : true,
    );

  const confirm = () => {
    if (!pending) return;
    onPick(pending);
  };

  const tabBtn = (p: Pane, label: string, Icon: typeof FolderOpen) => (
    <button
      key={p}
      type="button"
      onClick={() => {
        setPane(p);
        setError(null);
      }}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
        pane === p ? 'bg-glass-w12 text-retro-fg' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={options.title ?? 'Pick media'}
        className="bg-surface-raised border border-border-glass rounded-xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden text-retro-fg"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-glass">
          <h2 className="text-sm font-bold">{options.title ?? 'Pick media'}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close media picker"
            className="p-1 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border-glass">
          {sources.includes('browse') && tabBtn('browse', 'Your media', FolderOpen)}
          {sources.includes('upload') && tabBtn('upload', 'Upload', UploadCloud)}
          {sources.includes('url') && tabBtn('url', 'Paste URL', LinkIcon)}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 styled-scrollbar">
          {error && (
            <p className="text-xs font-bold text-retro-error" role="alert">
              {error}
            </p>
          )}

          {pane === 'browse' && (
            gallery.length === 0 ? (
              <p className="text-xs text-retro-muted py-6 text-center">
                Your gallery is empty — upload a file or paste a URL instead.
              </p>
            ) : (
              <>
                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter by tag…"
                  className="w-full px-3 py-1.5 rounded-lg bg-glass-w8 border border-border-glass text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent"
                />
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {filteredGallery.map((g: GalleryImage) => {
                    const video = keepIsVideo(g.url);
                    const selected = pending?.kind === 'url' && pending.url === g.url;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setError(null);
                          setPending({ kind: 'url', url: g.url, name: g.tags?.[0] ? `${g.tags[0]}` : undefined, source: 'browse' });
                        }}
                        className={`relative aspect-square rounded-lg overflow-hidden border transition-all cursor-pointer bg-glass-w8 ${
                          selected ? 'border-retro-accent ring-1 ring-retro-accent' : 'border-border-glass hover:border-retro-accent/60'
                        }`}
                        title={g.tags?.join(', ')}
                      >
                        {video ? (
                          <video src={g.url} muted preload="metadata" className="w-full h-full object-cover" />
                        ) : (
                          <img
                            src={g.url}
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
                            <ImageIcon className="w-5 h-5 text-white drop-shadow" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
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
              className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer text-center transition-all ${
                dragOver ? 'border-retro-accent bg-glass-w10' : 'border-border-glass hover:border-retro-accent bg-surface-interactive'
              }`}
            >
              <UploadCloud className="w-7 h-7 text-retro-muted" />
              <p className="text-xs font-bold text-retro-body">Drop a file, click to browse, or paste from the clipboard</p>
              <span className="text-[10px] text-retro-muted">{accept.join(' or ')}</span>
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
                <input
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
                  className="flex-1 px-3 py-1.5 rounded-lg bg-glass-w8 border border-border-glass text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent"
                />
                <button
                  type="button"
                  onClick={previewUrlInput}
                  className="px-3 py-1.5 rounded-lg chrome-accent text-black text-xs font-bold cursor-pointer active:scale-95 transition-transform"
                >
                  Preview
                </button>
              </div>
              <p className="text-[10px] text-retro-muted">The media is previewed before it is attached — broken links are caught here.</p>
            </div>
          )}

          {pending && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-center border border-border-glass rounded-xl bg-glass-w4 p-2">
                <Preview url={pending.kind === 'file' ? pending.previewUrl : pending.url} isVideo={pending.kind === 'file' ? fileAccepted(pending.file, ['video']) && !fileAccepted(pending.file, ['image']) : keepIsVideo(pending.url)} />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  className="px-4 py-1.5 rounded-lg chrome-accent text-black text-xs font-bold cursor-pointer active:scale-95 transition-transform"
                >
                  Use this media
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Promise-based handle: `const sel = await open(); if (!sel) return;`
 * Render `picker` once next to the caller's other modals.
 */
export function useMediaPicker(options: MediaPickerOptions) {
  type Resolver = ((sel: MediaSelection | null) => void) | null;
  const [resolveRef, setResolveRef] = useState<Resolver>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const open = useCallback(() => {
    return new Promise<MediaSelection | null>((resolve) => setResolveRef(() => resolve));
  }, []);

  const close = useCallback(() => {
    setResolveRef((resolve: Resolver) => {
      resolve?.(null);
      return null;
    });
  }, []);

  const finish = useCallback((sel: MediaSelection) => {
    setResolveRef((resolve: Resolver) => {
      resolve?.(sel);
      return null;
    });
  }, []);

  const picker = resolveRef ? (
    <MediaPickerModal options={optionsRef.current} onPick={finish} onClose={close} />
  ) : null;

  return { open, picker };
}
