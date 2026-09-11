"use client";

import { useEffect, useState } from 'react';
import { ImagePlus, Loader2, Plus, Sparkles, Tag, X } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { DropZone, DND_KEEPSAKE } from './DropZone';
import { uploadWithProgress } from '../utils/api';
import { mediaUrlToCachedFile } from '../utils/cacheMedia';
import { createCardFromMedia, type CanonicalCard, type CardCreationMetadata } from '../utils/cardCollection';
import { useCropper } from '../hooks/useCropper';
import { isCropableImage } from './CropModal';
import { playPress } from '../utils/sounds';

const MAX_TAGS = 8;

interface CreateCardModalProps {
  identity: OrbitIdentity | null;
  onClose: () => void;
  onCreated?: (card: CanonicalCard) => void;
  cardsNeeded?: number;
  /** Prefill from an existing image (e.g. idle gallery keepsake). */
  initialMedia?: { url: string; tags?: string[]; name?: string } | null;
  /** Prefill from a File dropped on the window (drag an image onto the app). */
  initialFile?: File | null;
}

export interface CardPrefill {
  url: string;
  tags: string[];
  name: string;
}

export function CreateCardModal({ identity, onClose, onCreated, cardsNeeded = 0, initialMedia = null, initialFile = null }: CreateCardModalProps) {
  const [file, setFile] = useState<File | null>(initialFile);
  const [url, setUrl] = useState('');
  const [name, setName] = useState(initialFile ? initialFile.name.replace(/\.[^.]+$/, '').slice(0, 80) : '');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('');
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { crop, cropper } = useCropper();

  // One-shot prefill (fresh mount per open): name/tags go straight in;
  // local-scheme media (idle-file://, blob:, data:) is fetched to a File
  // because the server can't fetch those URLs itself.
  useEffect(() => {
    if (!initialMedia) return;
    if (initialMedia.name) setName(initialMedia.name.slice(0, 80));
    if (initialMedia.tags?.length) {
      setTags(initialMedia.tags.map((t) => t.trim().toLowerCase().replace(/^#/, '').slice(0, 24)).filter(Boolean).slice(0, 8));
    }
    const mediaUrl = initialMedia.url;
    if (!/^(idle-file|blob|data):/.test(mediaUrl)) {
      setUrl(mediaUrl);
      return;
    }
    let cancelled = false;
    fetch(mediaUrl)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('fetch failed'))))
      .then((blob) => {
        if (cancelled || !blob.size) return;
        const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
        setFile(new File([blob], `keepsake-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' }));
      })
      .catch(() => {
        if (!cancelled) setUrl(mediaUrl);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(url.trim() || null);
      setPreviewMime('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setPreviewMime(file.type);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, url]);

  const isVideo = previewMime.startsWith('video/');
  const canCreate = Boolean((file || url.trim()) && name.trim() && !creating);
  const metadata: CardCreationMetadata = { tags, description };

  // Commit one or many tags from a comma/space separated entry.
  const commitTags = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
    if (parts.length === 0) return;
    setTags((current) => {
      const next = [...current];
      for (const t of parts) {
        if (next.length >= MAX_TAGS) break;
        const clean = t.slice(0, 24);
        if (clean && !next.includes(clean)) next.push(clean);
      }
      return next;
    });
    setTagInput('');
  };

  const addTag = () => commitTags(tagInput);

  const handleFiles = async (files: FileList | File[]) => {
    const next = Array.from(files)[0]
    if (!next) return
    if (isCropableImage(next)) {
      const res = await crop(next, { aspect: 'free', title: 'Crop card image' })
      if (!res) return
      setFile(res.file || next)
    } else {
      setFile(next)
    }
    setUrl('')
    setError(null)
  };

  // Drag a keepsake from the idle Gallery panel straight into the forge.
  const handlePayloadDrop = (type: string, payload: Record<string, unknown>) => {
    if (type !== DND_KEEPSAKE) return
    const mediaUrl = typeof payload.url === 'string' ? payload.url : ''
    if (!mediaUrl) return
    const tagList = Array.isArray(payload.tags) ? (payload.tags as string[]) : []
    const nameVal = typeof payload.name === 'string' ? payload.name : ''
    if (nameVal && !name) setName(nameVal.slice(0, 80))
    if (tagList.length) commitTags(tagList.join(','))
    if (/^(idle-file|blob|data):/.test(mediaUrl)) {
      void fetch(mediaUrl).then((r) => r.ok ? r.blob() : Promise.reject()).then((blob) => {
        const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
        setFile(new File([blob], `keepsake-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' }))
        setUrl('')
      }).catch(() => setUrl(mediaUrl))
    } else {
      setUrl(mediaUrl)
      setFile(null)
    }
    playPress(820)
  };

  const handlePasteUrl = (value: string) => {
    const trimmed = value.trim()
    if (trimmed.startsWith('data:')) {
      try {
        const [meta, b64] = trimmed.split(',')
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        setFile(new File([bytes], `card-${Date.now()}.jpg`, { type: mime }))
        setUrl('')
        setError(null)
        return
      } catch { /* fall through to URL handling */ }
    }
    setUrl(trimmed)
    setFile(null)
    setError(null)
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    if (!identity) {
      setError('You must be logged in to create a card');
      return;
    }
    setCreating(true);
    setError(null);
    setProgress(0);
    try {
      let payloadFile = file
      if (!payloadFile) {
        // Cache-first: forge a card ONLY from bytes we fetched ourselves. A
        // live-URL card dies when the host blocks hotlinks (user rule: gallery
        // and cards are cache, never a live URL).
        payloadFile = await mediaUrlToCachedFile(url.trim());
      }
      const form = new FormData();
      form.append('is_story', 'false');
      form.append('image', payloadFile);

      const upload = await uploadWithProgress('/api/objects', form, identity, setProgress);

      if (!upload.ok || !upload.id) {
        throw new Error(upload.error || 'Media upload failed');
      }

      setProgress(92);
      const card = await createCardFromMedia(identity, upload.id, name, metadata);
      if (!card) throw new Error('The media uploaded, but card creation failed');
      setProgress(100);
      onCreated?.(card);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create card');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6" onMouseDown={onClose}>
      <div className="glass-surface w-full max-w-5xl max-h-[92dvh] overflow-y-auto rounded-xl p-4 sm:p-6 text-retro-fg" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-retro-accent text-[10px] font-black uppercase tracking-[0.18em]">
              <Sparkles className="w-4 h-4" /> Card Forge
            </div>
            <h2 className="text-xl sm:text-2xl font-black mt-1">Create a unique card</h2>
            <p className="text-xs text-retro-muted mt-1">Build the look now. Rarity and value are assigned by the server after creation.</p>
          </div>
          <button type="button" onClick={onClose} className="glass-button p-2 rounded-xl text-retro-muted hover:text-retro-fg" aria-label="Close card creator">
            <X className="w-5 h-5" />
          </button>
        </div>

        {cardsNeeded > 0 && (
          <div className="mb-4 rounded-xl border border-retro-warning/30 bg-retro-warning/10 px-3 py-2 text-xs text-retro-warning">
            Quick Play needs {cardsNeeded} more card{cardsNeeded === 1 ? '' : 's'}.
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] gap-5">
          <div className="flex flex-col items-center gap-3">
            <div className="w-full max-w-[270px] aspect-[3/4.2] rounded-xl p-1.5 transition-all" style={{ background: `linear-gradient(135deg, #9FE3FF, rgba(255,255,255,.55), #9FE3FF)`, boxShadow: '0 18px 50px #9FE3FF44' }}>
              <div className="relative w-full h-full overflow-hidden rounded-xl bg-surface-canvas flex flex-col">
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/20 via-transparent to-transparent z-10" />
                <div className="aspect-[3/3.1] bg-black/30 overflow-hidden flex items-center justify-center">
                  {previewUrl ? (isVideo ? <video src={previewUrl} className="w-full h-full object-cover" autoPlay muted loop playsInline /> : <img src={previewUrl} alt="Card preview" className="w-full h-full object-cover" />) : <ImagePlus className="w-10 h-10 text-retro-muted" />}
                </div>
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-retro-muted">Chrome edition</div>
                    <div className="text-base font-black truncate mt-1">{name.trim() || 'Your Card Name'}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(tags.length ? tags : ['your-tags']).map((tag) => <span key={tag} className="text-[10px] rounded-full border px-1.5 py-0.5" style={{ borderColor: '#9FE3FF88', color: '#9FE3FF' }}>#{tag}</span>)}
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-2">
                    <span className="text-[10px] text-retro-muted line-clamp-2">{description.trim() || 'Polished silver edge'}</span>
                    <span className="text-[10px] font-mono font-bold" style={{ color: '#9FE3FF' }}>VALUE TBD</span>
                  </div>
                </div>
              </div>
            </div>
            <span className="text-[10px] text-retro-muted">Live preview</span>
          </div>

          <div className="space-y-4">
            <DropZone onFiles={handleFiles} onPasteUrl={handlePasteUrl} onPayloadDrop={handlePayloadDrop} compact={false} accept="image/jpeg, image/png, image/webp, image/avif, image/gif, video/mp4, video/webm, video/quicktime, video/ogg, video/*" multiple={false}>
              <div className="space-y-2 py-2">
                <ImagePlus className="w-7 h-7 mx-auto text-retro-accent" />
                <p className="text-sm text-retro-body">Drop an image or video, browse, or paste a URL</p>
                <p className="text-[10px] text-retro-muted">Or drag a keepsake in from the Gallery panel. The original media stays private until you share or play it.</p>
              </div>
            </DropZone>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">Card name *</span>
                <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Give a unique name to this nice card" className="w-full px-3 py-2.5 text-sm" autoFocus />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 240))} placeholder="What's all that about? Describe your gooning material if you feel like so." rows={3} className="w-full px-3 py-2.5 text-sm resize-none" />
              </label>
              <div className="sm:col-span-2 space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">Tags <span className="normal-case font-normal">({tags.length}/{MAX_TAGS}) — comma or space separated</span></span>
                <div className="flex gap-2">
                  <div className="relative flex-1"><Tag className="absolute left-3 top-3 w-4 h-4 text-retro-muted" /><input value={tagInput} maxLength={MAX_TAGS * 25} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); } }} onBlur={() => { if (tagInput.trim()) addTag(); }} placeholder="futa, bbc, BWNO, hentai" className="w-full pl-9 pr-3 py-2.5 text-sm" /></div>
                  <button type="button" onClick={addTag} disabled={tags.length >= MAX_TAGS || !tagInput.trim()} className="glass-button px-3 rounded-xl disabled:opacity-40" aria-label="Add tag"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-6">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags((current) => current.filter((item) => item !== tag))} className="glass-button rounded-full px-2 py-1 text-[10px] text-retro-body">#{tag} x</button>)}</div>
              </div>
            </div>

            {creating && <div className="space-y-1"><div className="flex justify-between text-[10px] text-retro-muted"><span>Forging card...</span><span>{progress}%</span></div><div className="h-1.5 rounded-full bg-black/30 overflow-hidden"><div className="h-full bg-retro-accent transition-all" style={{ width: `${progress}%` }} /></div></div>}
            {error && <div className="rounded-xl border border-retro-error/30 bg-retro-error/10 px-3 py-2 text-xs text-retro-error">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="glass-button px-4 py-2.5 rounded-xl text-xs font-bold">Cancel</button>
              <button type="button" onClick={handleCreate} disabled={!canCreate} className="accent-control px-4 py-2.5 rounded-xl text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">{creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {creating ? 'Creating...' : 'Create Card'}</button>
            </div>
          </div>
        </div>
      </div>
      {cropper}
    </div>
  );
}
