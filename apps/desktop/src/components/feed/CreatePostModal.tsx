"use client";

import { useState, useRef, useEffect } from 'react';
import { playPress } from '../../utils/sounds';
import { useCropper } from '../../hooks/useCropper';
import { isCropableImage } from '../CropModal';
import {
  X,
  MapPin,
  Tag,
  UploadCloud,
  Camera,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Link2,
} from 'lucide-react';
import { useMediaPicker } from '../media/MediaPickerModal';
import { selectionToFile, type MediaSelection } from '../media/picker';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../../utils/api';
import { mediaUrlToCachedFile } from '../../utils/cacheMedia';
import { isMediaVideo, isTwitterUrl, isVideoPageUrl, isVideoPost, resolveTwitterMediaAll, resolveVideoMime, sniffFileHead, urlFallbackMime } from '../../utils/media';
import { forgeMediaLocally } from '../../services/mediaForge';
import { devFetchable } from '../../services/imageCache';
import { Button, Input, Textarea } from '../../ui/kit';
import { classes, COLOR, FIELD, RADIUS } from '../../ui/tokens';

/** One opaque plate for every media surface on the composer. The glass roles
 *  let the page show through a dialog; a media box must not (a half-loaded
 *  picture behind it reads as part of the attachment). */
const OPAQUE_PLATE = classes('border', COLOR.edge, RADIUS.panel, COLOR.canvasSurface);

interface PostMediaItem {
  id: string;
  file?: File;
  previewUrl: string;
  isExternalUrl?: boolean;
  /** Original page URL when previewUrl is a resolved direct-media URL. */
  originalUrl?: string;
  /** Watch/embed page (resolves server-side at share time). */
  isVideoPage?: boolean;
  /** Known media kind, carried from gallery/vault reposts so video detection
   * never depends on extension-sniffing opaque local URLs. */
  kind?: 'video' | 'image';
  /** Known MIME type, carried alongside kind when the source knows it. */
  mimeType?: string;
  /** Paste-time resolution failed (preview honest, share may still resolve). */
  resolveNote?: string;
}

export function CreatePostModal({
  identity,
  onClose,
  onPostCreated,
  toast,
  initialMedia,
  initialTags,
  initialCaption,
  mode = 'post',
}: {
  identity: OrbitIdentity | null;
  onClose: () => void;
  onPostCreated?: (newPost: any) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  initialMedia?: PostMediaItem[];
  initialTags?: string;
  initialCaption?: string;
  mode?: 'post' | 'story';
}) {
  const [mediaSource, setMediaSource] = useState<'idle' | 'camera'>('idle');
  const [showUrlInput, setShowUrlInput] = useState(false);
  /** Text posts are a first-class mode, not an empty media box with words. */
  const [textMode, setTextMode] = useState(false);
  const [mediaList, setMediaList] = useState<PostMediaItem[]>(() => initialMedia || []);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [caption, setCaption] = useState(initialCaption || '');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState(initialTags || '');
  const [aspectRatio, setAspectRatio] = useState<'square' | 'portrait' | 'landscape'>('square');
  const [uploading, setUploading] = useState(false);
  /** Posting outcome, shown INLINE as well as toasted — the user must never
   *  be left guessing whether a post landed. */
  const [publishStatus, setPublishStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);
  /** Typed link to post as a shared anchor (not media). */
  const [linkUrl, setLinkUrl] = useState('');

  // Camera state
  const [,setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { crop, cropper } = useCropper();

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: any) {
      setCameraError(err.message || 'Camera access denied or unavailable');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    if (mediaSource === 'camera') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [mediaSource]);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const shotDataUrl = canvas.toDataURL('image/jpeg', 0.9);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      let file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      let previewUrl = shotDataUrl;
      const res = await crop(file, { aspect: '4:5', title: 'Crop post image' });
      if (!res) return;
      if (res.file) file = res.file;
      previewUrl = res.dataUrl;
      const newItem: PostMediaItem = { id: 'cam_' + Date.now(), file, previewUrl };
      setMediaList((prev) => { setActiveMediaIndex(prev.length); return [...prev, newItem]; });
      playPress(880);
    }, 'image/jpeg', 0.9);
  };

  const MAX_MEDIA = 10;

/** Preview-time video check: carried kind/mime first, recovered file type, then URL. */
function itemLooksVideo(m: PostMediaItem): boolean {
  if (m.kind === 'video') return true;
  if (m.kind === 'image') return isMediaVideo(m.mimeType || m.file?.type || m.previewUrl);
  return isVideoPost(m.mimeType || m.file?.type, m.previewUrl);
}

/** Filename extension matching a MIME type (cosmetic: names never drive type detection). */
function extForMime(mime: string): string {
  const t = (mime || '').toLowerCase().split(';')[0].trim();
  if (t === 'video/mp4' || t === 'video/m4v') return 'mp4';
  if (t === 'video/webm') return 'webm';
  if (t === 'video/quicktime') return 'mov';
  if (t === 'video/x-matroska') return 'mkv';
  if (t === 'video/ogg') return 'ogv';
  if (t === 'image/png') return 'png';
  if (t === 'image/gif') return 'gif';
  if (t === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * True when a URL points straight at media BYTES (an image / video file), as
 * opposed to a page that merely shows one.
 *
 * The share path proxies every URL as if it were an image, so this decides
 * whether a pasted link belongs in the media list or in the written body.
 * Extension-less URLs are NOT media here: a query-string image
 * (`?image=…`) is rare next to the far more common article/product link, and
 * a false positive means the post FAILS instead of degrading to a text post.
 */
function isDirectMediaUrl(raw: string): boolean {
  try {
    const clean = new URL(raw).pathname.toLowerCase();
    return /\.(?:jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov|m4v|ogv|mkv)$/.test(clean);
  } catch {
    return false;
  }
}

/**
 * Put a shared link into the written body.
 *
 * Appended, never replacing: the player may have written a caption already, and
 * the link is the thing being shared, not a reason to lose their words. The
 * feed renders it as a safe anchor (Linkify) and the notification/permalink
 * paths already escape everything.
 */
function addLinkToCaption(raw: string): void {
  setCaption((prev) => {
    const trimmed = prev.trim();
  if (trimmed.includes(raw)) return prev;
  return trimmed ? `${trimmed}\n${raw}` : raw;
  });
  toast?.('Link added to your post.', 'success');
  playPress(840);
}

  const handleFilesSelected = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_MEDIA - mediaList.length;
    if (room <= 0) {
      toast?.(`Max ${MAX_MEDIA} items per post`, 'warning');
      return;
    }
    const picked = files.length > room ? (toast?.(`Max ${MAX_MEDIA} items per post`, 'warning'), Array.from(files).slice(0, room)) : Array.from(files);
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      let file = f;
      let previewUrl = URL.createObjectURL(file);
      if (isCropableImage(file)) {
        const res = await crop(file, { aspect: '4:5', title: 'Crop post image' });
        if (!res) continue;
        if (res.file) file = res.file;
        previewUrl = res.dataUrl;
      }
      // Windows/Electron often reports MP4s with an empty File.type — recover
      // the video MIME now (extension, then magic bytes) so the forge,
      // register, and render paths all treat it as video.
      if (!file.type || file.type === 'application/octet-stream') {
        const head = await sniffFileHead(file).catch(() => null);
        const recovered = resolveVideoMime({ type: file.type, name: file.name, bytes: head });
        if (recovered) {
          file = new File([file], file.name, { type: recovered });
          try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
          previewUrl = URL.createObjectURL(file);
        }
      }
      const newItem: PostMediaItem = { id: 'file_' + Date.now() + '_' + i, file, previewUrl };
      setMediaList((prev) => [...prev, newItem]);
    }
    playPress(800);
  };

  /** Attach a URL picked or pasted as text: resolves page links (X posts)
   *  to direct media, otherwise attaches the link itself. */
  const takeUrl = async (raw: string) => {
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      toast?.('Paste a full https:// link', 'warning');
      return;
    }
    // A link that is NOT media belongs in the written body, not in the media
    // list: the server proxies every URL as if it were an image, so a news
    // article or a product page failed with "Could not fetch or validate the
    // URL" and the post could not be made at all. The feed already renders
    // URLs in a caption as safe anchors (Linkify), so a text post that carries
    // a link is the SAME post — no schema, no migration.
    //
    // A video PAGE (redgifs watch, YouTube, Vimeo) still goes to the media
    // list: the server has a resolver for those and the row is honest about
    // being a placeholder until it lands.
    if (!isDirectMediaUrl(raw) && !isTwitterUrl(raw) && !isVideoPageUrl(raw)) {
      addLinkToCaption(raw);
      return;
    }
    // Page URLs (X posts, watch pages) are not media bytes: resolve to a
    // direct file for an honest preview now; the server re-resolves at
    // share time as a second chance.
    if (isTwitterUrl(raw)) {
      const directs = await resolveTwitterMediaAll(raw).catch(() => null);
      if (directs && directs.length > 0) {
        const ts = Date.now();
        setMediaList((prev) => [
          ...prev,
          ...directs.map((url, idx) => ({
            id: `url_${ts}_${idx}`,
            previewUrl: url,
            originalUrl: raw,
            isExternalUrl: true,
          })),
        ]);
        toast?.(directs.length > 1 ? `Attached ${directs.length} items from post link` : 'Attached media from post link', 'success');
      } else {
        setMediaList((prev) => [
          ...prev,
          { id: 'url_' + Date.now(), previewUrl: raw, isExternalUrl: true, isVideoPage: true, resolveNote: 'Preview not ready. It attaches on share.' },
        ]);
        toast?.('Kept the link. Media attaches when you share.', 'info');
      }
      playPress(840);
      return;
    }
    const newItem: PostMediaItem = {
      id: 'url_' + Date.now(),
      previewUrl: raw,
      isExternalUrl: true,
      isVideoPage: isVideoPageUrl(raw) || undefined,
    };
    setMediaList((prev) => [...prev, newItem]);
    playPress(840);
  };

  // B7: the shared picker replaces the old paste-URL tab. Keepsake URLs
  // (idle-file:/vault/loopback schemes) point at THIS machine's bytes, so
  // they are fetched to a real File and ride the normal upload path.
  const { open: openMediaPicker, picker: mediaPickerEl } = useMediaPicker({
    accept: ['image', 'video'],
    sources: ['browse', 'upload', 'url'],
    title: mode === 'story' ? 'Pick story media' : 'Pick post media',
  });
  const takePickerSelection = async (sel: MediaSelection) => {
    if (sel.kind === 'file') {
      await handleFilesSelected([sel.file]);
      return;
    }
    if (/^https?:/i.test(sel.url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(sel.url)) {
      await takeUrl(sel.url);
      return;
    }
    const file = await selectionToFile(sel, 'keepsake');
    if (file) await handleFilesSelected([file]);
    else toast?.('That media could not be read from this device — paste a public link instead.', 'warning');
  };

  const removeMedia = (idx: number) => {
    setMediaList((prev) => prev.filter((_, i) => i !== idx));
    if (activeMediaIndex >= idx && activeMediaIndex > 0) {
      setActiveMediaIndex((prev) => prev - 1);
    }
  };

  const moveMedia = (from: number, to: number) => {
    if (to < 0 || to >= mediaList.length) return;
    setMediaList((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    setActiveMediaIndex(to);
    playPress(720);
  };

  /** One place owns "the post landed" — inline banner, toast, then close on
   *  the next beat so the banner is actually readable. */
  const finishSuccess = (message: string) => {
    setPublishStatus({ kind: 'success', message });
    toast?.(message, 'success');
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => onClose(), 600);
  };
  const failPublish = (message: string, type: 'error' | 'warning' = 'error') => {
    setPublishStatus({ kind: 'error', message });
    toast?.(message, type);
  };

  const handleShare = async () => {
    if (!identity) {
      failPublish('Please sign in to share posts');
      return;
    }
    // Stories are media-only. A caption is not a story: refuse the attempt
    // with the real reason inline instead of publishing a text row the tray
    // would never show (the server marks it is_story and hides it).
    if (mode === 'story' && mediaList.length === 0) {
      failPublish('Stories need a photo or video. Add media before sharing.', 'warning');
      return;
    }
    if (mediaList.length === 0 && !caption.trim()) {
      failPublish('Write something, or add a photo', 'warning');
      return;
    }

    setPublishStatus(null);
    setUploading(true);
    playPress(880);

    try {
      // Sequential uploads keep insertion order; one shared post_group turns
      // the N objects into a single coalesced post server-side. Only the
      // first row carries caption/location/tags.
      const postGroup = crypto.randomUUID();
      const ids: string[] = [];

      // Text-only post (Twitter-style): the same object row with no bytes. The
      // API accepts it and the feed renders the written body.
      if (mediaList.length === 0) {
        const form = new FormData();
        form.append('post_caption', caption.trim());
        form.append('location', location.trim());
        form.append('tags', tags.trim());
        form.append('is_public', mode === 'story' ? '0' : '1');
        form.append('post_group', postGroup);
        const res = await orbitFetch('/api/objects', { method: 'POST', body: form }, identity);
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || 'Could not publish the post');
        }
        const data = await res.json();
        finishSuccess('Post shared.');
        onPostCreated?.({
          id: data.id,
          author_id: identity.orbitId,
          author_name: 'You',
          author_avatar: null,
          url: '',
          mediaUrls: [],
          localPreviewUrl: null,
          mime_type: undefined,
          caption: caption.trim(),
          location: location.trim(),
          tags: tags.split(/[\s,#]+/).map((t) => t.trim()).filter(Boolean),
          created_at: new Date().toISOString(),
          like_count: 0,
          comment_count: 0,
          is_liked: false,
          is_saved: false,
        });
        return;
      }

      let primaryId = '';
      let primaryLocalUrl: string | null = null;
      let primaryMime: string | null = null;
      // Per-item failures are collected, not fatal: one unreadable file must
      // not discard the whole carousel. The post fails only if NOTHING lands.
      const itemErrors: string[] = [];
      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const formData = new FormData();
        let uploadFile = item.file;
        if (!uploadFile && (item.previewUrl.startsWith('data:') || item.previewUrl.startsWith('blob:'))) {
          try {
            const blob = await fetch(item.previewUrl).then((r) => r.blob());
            uploadFile = new File([blob], `media_${i}.${extForMime(blob.type)}`, { type: blob.type || 'image/jpeg' });
          } catch {
            /* fall back to url */
          }
        }
        if (!uploadFile && (/^(gmcache|idle-file|vault):/i.test(item.previewUrl) || item.previewUrl.startsWith('/booru/'))) {
          try {
            uploadFile = await mediaUrlToCachedFile(item.previewUrl);
          } catch {
            /* fall back to url */
          }
        }
        if (!uploadFile && item.previewUrl.includes('/api/objects/')) {
          // Server-side repost (gallery/feed item): check local swarm/indexedDB first
          try {
            const cleanId = item.previewUrl.split('/api/objects/')[1]?.split(/[?#]/)[0] || '';
            const { getLocalObject, requestSwarmObject } = await import('../../utils/p2pSwarm');
            let blob: Blob | null = cleanId ? await getLocalObject(cleanId) : null;
            if (!blob && cleanId) {
              try {
                blob = await requestSwarmObject(cleanId, 3000);
              } catch {
                /* fallback to orbitFetch */
              }
            }
            if (!blob) {
              const res = await orbitFetch(item.previewUrl, {}, identity);
              if (res.ok) {
                const ctype = (res.headers.get('Content-Type') || '').toLowerCase();
                if (ctype.includes('json')) {
                  const data = await res.json().catch(() => null);
                  if (data?.content_hash) {
                    blob = (await getLocalObject(data.content_hash)) || null;
                    if (!blob) {
                      try {
                        blob = await requestSwarmObject(data.content_hash, 3000, { expectedHash: data.content_hash });
                      } catch {
                        /* fallback */
                      }
                    }
                  }
                } else {
                  blob = await res.blob();
                }
              }
            }
            if (blob && blob.size > 0 && !blob.type.includes('json')) {
              uploadFile = new File([blob], `media_${i}.${extForMime(blob.type)}`, { type: blob.type || 'image/jpeg' });
            }
          } catch {
            /* fall back to url */
          }
        }
        if (!uploadFile && /^https?:\/\//i.test(item.previewUrl)) {
          try {
            // Booru bytes reject raw cross-origin fetches (CORS + hotlink
            // 403). mediaUrlToCachedFile is the cache-first ladder: Electron
            // gmcache (local PC bytes, zero re-download for drained idle
            // images) -> dev /px proxy -> direct fetch.
            uploadFile = await mediaUrlToCachedFile(item.previewUrl)
          } catch {
            /* fall back to url */
          }
        }

        try {
          if (uploadFile) {
            // Zero-media P2P path: seed locally into swarm and register metadata
            // with central server. Never sends raw binary bytes (which 422).
            const forged = await forgeMediaLocally(uploadFile, identity, {
              caption: mode === 'story' || i !== 0 ? undefined : caption.trim(),
              postCaption: mode === 'story' || i !== 0 ? undefined : caption.trim(),
              location: mode === 'story' || i !== 0 ? undefined : location.trim(),
              tags: mode === 'story' || i !== 0 ? undefined : tags.trim(),
              isPublic: mode !== 'story',
              isStory: mode === 'story',
              postGroup,
              durable: true,
            });
            ids.push(forged.id);
            if (!primaryId) primaryId = forged.id;
            // Instant tile: render the session blob URL with zero fetch.
            if (!primaryLocalUrl && forged.localUrl) primaryLocalUrl = forged.localUrl;
            // Optimistic mime so the feed renders <video> immediately (the
            // forge already recovered empty File.types via resolveVideoMime).
            if (!primaryMime && forged.mimeType) primaryMime = forged.mimeType;
          } else {
            // Local-only URLs (vault/gmcache/loopback) can never render off
            // this machine: they must resolve to bytes + forge above. Posting
            // the URL string would store an unrenderable row for everyone.
            if (/^(gmcache|idle-file|vault):/i.test(item.previewUrl) || item.previewUrl.includes('/api/objects/') || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(item.previewUrl)) {
              throw new Error('Could not read those local bytes for sharing — try again or pick the file directly');
            }
            formData.append('url', item.previewUrl);
            formData.append('is_public', mode === 'story' ? '0' : '1');
            if (mode === 'story') {
              formData.append('is_story', 'true');
            }
            formData.append('post_group', postGroup);
            const fallbackMime = urlFallbackMime(item as any);
            if (!primaryMime) primaryMime = item.mimeType || fallbackMime;
            if (fallbackMime) {
              formData.append('mime_type', fallbackMime);
            }
            if (i === 0 && mode !== 'story') {
              formData.append('post_caption', caption.trim());
              formData.append('location', location.trim());
              formData.append('tags', tags.trim());
            }
            const res = await orbitFetch('/api/objects', { method: 'POST', body: formData }, identity);
            if (!res.ok) {
              const errData = await res.json().catch(() => null);
              let host = '';
              try { host = new URL(item.previewUrl).hostname; } catch { /* relative/data urls */ }
              const hint = item.isVideoPage || (host && !/\.(jpe?g|png|gif|webp|mp4|webm)$/i.test(item.previewUrl.split('?')[0]))
                ? ', that link has no direct media. Try a direct image/GIF/MP4 URL'
                : '';
              throw new Error(errData?.error || `Upload failed on item ${i + 1} of ${mediaList.length}${host ? ` (${host})` : ''}${hint}`);
            }
            const data = await res.json();
            if (data.id) {
              ids.push(data.id);
              if (!primaryId) primaryId = data.id;
            }
          }
        } catch (err) {
          // One bad item is a partial success, not a failed post: record it
          // and keep going so the rest of the carousel still publishes.
          itemErrors.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (ids.length === 0) {
        // Nothing at all landed: report the real reason instead of posting an
        // empty row that claims success.
        throw new Error(itemErrors[0] || 'Could not publish the post');
      }
      const objectId = primaryId || 'post_' + Math.random().toString(36).substring(2, 9);
 
      playPress(800);
      finishSuccess(mode === 'story' ? 'Added to your story.' : 'Post shared.');

      onPostCreated?.({
        id: objectId,
        author_id: identity.orbitId,
        author_name: 'You',
        author_avatar: null,
        url: primaryId ? `/api/objects/${primaryId}` : (mediaList[0]?.previewUrl || ''),
        mediaUrls: ids.map((id) => `/api/objects/${id}`),
        localPreviewUrl: primaryLocalUrl,
        mime_type: primaryMime || undefined,
        caption: caption.trim(),
        location: location.trim(),
        tags: tags.split(/[\s,#]+/).map((t) => t.trim()).filter(Boolean),
        created_at: new Date().toISOString(),
        like_count: 0,
        comment_count: 0,
        is_liked: false,
        is_saved: false,
      });

    } catch (err: any) {
      // The modal stays open and says what went wrong — no guessing, no
      // silent loss of the caption/media the user just assembled.
      failPublish(err?.message || 'Failed to share post');
    } finally {
      setUploading(false);
    }
  };

  // The written body is not media: it renders for every post, including a
  // text-only one (no bytes attached).
  const captionField = (
              <div>
                <Textarea
                  id="text-post-body"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={mediaList.length === 0 ? 'What is happening?!' : 'Write a caption...'}
                  rows={3}
                  maxLength={1000}
                />
                <div className="text-right text-2xs font-mono text-retro-muted mt-0.5">
                  {caption.length}/1000
                </div>
              </div>
  )

  const addFromPicker = () => void openMediaPicker().then((sel) => { if (sel) void takePickerSelection(sel); });

  /** One URL row, shared by the empty box and the "add more" row. */
  const urlInputRow = (
    <div className="flex w-full gap-2">
      <div className="relative flex-1 min-w-0">
        <Link2 className="w-3.5 h-3.5 text-retro-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          type="url"
          inputMode="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void takeUrl(linkUrl.trim());
            setLinkUrl('');
          }}
          placeholder="Paste an image or video URL…"
          aria-label="Media URL"
          className="pl-9"
        />
      </div>
      <Button
        variant="primary"
        size="md"
        disabled={!linkUrl.trim()}
        onClick={() => { void takeUrl(linkUrl.trim()); setLinkUrl(''); }}
        className="shrink-0"
      >
        Attach
      </Button>
    </div>
  );

  const currentMedia = mediaList[activeMediaIndex] || mediaList[0];

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 pb-[calc(0.75rem+var(--island-clearance))] sm:p-4 sm:pb-[calc(1rem+var(--island-clearance))] font-sans select-none animate-orbit-fade-in"
    >
      <div
        className={`w-full max-w-2xl ${COLOR.canvasSurface} border border-edge rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-var(--island-clearance)-2rem)] text-retro-fg animate-orbit-pop`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5"
          >
            <X className="w-5 h-5" />
          </Button>

          <span className="font-black uppercase tracking-tight text-base text-retro-fg">
            {mode === 'story' ? 'Create Story' : 'Create Post'} {mediaList.length > 0 ? `(${mediaList.length} media)` : ''}
          </span>

          <Button
            variant="primary"
            size="sm"
            onClick={handleShare}
            disabled={uploading || (mediaList.length === 0 && !caption.trim())}
            className="px-4"
          >
            {uploading ? 'Sharing...' : (mode === 'story' ? 'Share Story' : 'Share')}
          </Button>
        </div>

        {/* Posting outcome — inline, not only in the header notification
            centre. An error keeps the modal open with its content intact. */}
        {publishStatus && (
          <div
            role={publishStatus.kind === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between gap-2 px-4 py-2 border-b text-xs ${publishStatus.kind === 'error' ? 'border-danger/40 bg-danger/10 text-danger-fg' : 'border-success/40 bg-success/10 text-success-fg'}`}
          >
            <span>{publishStatus.message}</span>
            {publishStatus.kind === 'error' && (
              <button type="button" onClick={() => setPublishStatus(null)} className="cursor-pointer underline underline-offset-2">Dismiss</button>
            )}
          </div>
        )}

        {/* Text posts are explicit. Stories never offer this: they are
            media-only, so the button does not exist there at all. */}
        {mode !== 'story' && (
          <div className="flex items-center justify-between border-b border-edge px-4 py-2">
            <Button
              variant={textMode ? 'secondary' : 'link'}
              size="sm"
              onClick={() => { playPress(750); setTextMode((v) => !v); setMediaSource('idle'); }}
            >
              {textMode ? 'Add media instead' : 'Write a text post'}
            </Button>
            {textMode && <span className="text-2xs text-retro-muted">No media needed — just words.</span>}
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 styled-scrollbar">
          {/* One hidden file input for the whole composer: both the empty box
              and the "Add more" row trigger it via fileInputRef. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="hidden"
          />
          {textMode ? (
            <div className="space-y-3">
              <div className={`${OPAQUE_PLATE} p-4`}>
                <label className="text-xs font-bold text-retro-body" htmlFor="text-post-body">Your post</label>
                <div className="mt-2">{captionField}</div>
              </div>
              <Button variant="secondary" size="md" onClick={() => setTextMode(false)}>
                <FolderOpen className="w-4 h-4" />
                <span>Add media</span>
              </Button>
            </div>
          ) : (
          <div className={classes('grid grid-cols-1 gap-4 items-start', mode !== 'story' && 'md:grid-cols-2')}>
            {mode !== 'story' && <div className="space-y-3 md:order-2">{captionField}</div>}
            <div className="space-y-3 md:order-1">

          {mediaSource === 'camera' && (
            <div className={`${OPAQUE_PLATE} p-2 flex flex-col items-center gap-3`}>
              {cameraError ? (
                <div className="p-6 text-center text-xs text-retro-error font-bold">
                  {cameraError}
                </div>
              ) : (
                <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-surface-canvas flex items-center justify-center">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 pb-1">
                <Button variant="primary" size="md" onClick={capturePhoto}>
                  <Camera className="w-4 h-4" />
                  <span>Snap Picture</span>
                </Button>
                <Button variant="secondary" size="md" onClick={() => setMediaSource('idle')}>Done</Button>
              </div>
            </div>
          )}

          {mediaList.length === 0 && mediaSource !== 'camera' && (
            <div className={`${OPAQUE_PLATE} border-2 border-dashed p-5 flex flex-col items-center gap-3 text-center`}>
              <UploadCloud className="w-8 h-8 text-retro-muted" />
              <div>
                <p className="text-xs font-bold text-retro-body">Drop photos or video here</p>
                <span className="text-2xs text-retro-muted">Images and video, up to {MAX_MEDIA}. {mediaList.length}/{MAX_MEDIA} added</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" size="md" onClick={() => fileInputRef.current?.click()}>
                  <UploadCloud className="w-4 h-4" />
                  <span>Upload</span>
                </Button>
                <Button variant="secondary" size="md" onClick={addFromPicker}>
                  <FolderOpen className="w-4 h-4" />
                  <span>Browse keepsakes</span>
                </Button>
                <Button variant="secondary" size="md" onClick={() => { playPress(750); setMediaSource('camera'); }}>
                  <Camera className="w-4 h-4" />
                  <span>Camera</span>
                </Button>
                {mode !== 'story' && (
                  <Button variant="secondary" size="md" onClick={() => { playPress(750); setShowUrlInput((v) => !v); }}>
                    <Link2 className="w-4 h-4" />
                    <span>URL</span>
                  </Button>
                )}
              </div>
              {showUrlInput && urlInputRow}
            </div>
          )}

          {mediaList.length > 0 && mediaSource !== 'camera' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <UploadCloud className="w-3.5 h-3.5" /><span>Add more</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={addFromPicker}>
                <FolderOpen className="w-3.5 h-3.5" /><span>Browse keepsakes</span>
              </Button>
              {mode !== 'story' && (
                <Button variant="secondary" size="sm" onClick={() => { playPress(750); setShowUrlInput((v) => !v); }}>
                  <Link2 className="w-3.5 h-3.5" /><span>URL</span>
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => { playPress(750); setMediaSource('camera'); }}>
                <Camera className="w-3.5 h-3.5" /><span>Camera</span>
              </Button>
            </div>
          )}
          {mediaList.length > 0 && showUrlInput && mediaSource !== 'camera' && urlInputRow}

          {/* Carousel & Multi-Media Viewer */}
          {mediaList.length > 0 && currentMedia && (
            <div className="space-y-3">
              <div className={`relative w-full rounded-xl overflow-hidden ${COLOR.canvasSurface} flex items-center justify-center border border-edge group`}>
                {currentMedia.isVideoPage ? (
                  <div className="w-full aspect-video flex flex-col items-center justify-center gap-2 p-4 text-center">
                    <span className={`w-10 h-10 rounded-full ${COLOR.canvasSurface} border border-edge flex items-center justify-center text-retro-fg text-xs font-black`}>▶</span>
                    <span className="text-xs font-semibold text-retro-fg">Video link attached</span>
                    <span className="text-2xs text-retro-muted break-all max-w-full">
                      {(currentMedia.originalUrl || currentMedia.previewUrl).slice(0, 80)}
                    </span>
                    <span className="text-2xs text-retro-muted">
                      {currentMedia.resolveNote || 'Media attaches when you share'}
                    </span>
                  </div>
                ) : (
                  <>
                    {itemLooksVideo(currentMedia) ? (
                      <video src={devFetchable(currentMedia.previewUrl) || currentMedia.previewUrl} muted playsInline controls preload="auto" className={`w-full object-cover ${aspectRatio === 'square' ? 'aspect-square' : aspectRatio === 'portrait' ? 'aspect-[4/5]' : 'aspect-[16/9]'}`} />
                    ) : null}
                    {!itemLooksVideo(currentMedia) && (
                    <img
                      src={devFetchable(currentMedia.previewUrl) || currentMedia.previewUrl}
                      alt=""
                      className={`w-full object-cover transition ${aspectRatio === 'square'
                        ? 'aspect-square'
                        : aspectRatio === 'portrait'
                          ? 'aspect-[4/5]'
                          : 'aspect-[16/9]'
                        }`}
                    />
                    )}
                  </>
                )}

                {/* Aspect Ratio Switcher */}
                <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md rounded-xl p-1 flex items-center gap-1 text-2xs font-bold text-retro-fg z-10">
                  {(['square', 'portrait', 'landscape'] as const).map((ratio) => (
                    <Button
                      key={ratio}
                      variant={aspectRatio === ratio ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setAspectRatio(ratio)}
                      className="px-2 py-1 capitalize"
                    >
                      {ratio}
                    </Button>
                  ))}
                </div>

                {/* Left/Right Cycle Arrows */}
                {mediaList.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { playPress(750); setActiveMediaIndex((prev) => (prev > 0 ? prev - 1 : mediaList.length - 1)); }}
                      className={`absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full p-0 ${COLOR.scrim}`}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { playPress(750); setActiveMediaIndex((prev) => (prev < mediaList.length - 1 ? prev + 1 : 0)); }}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full p-0 ${COLOR.scrim}`}
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </>
                )}

                {/* Delete Media Button */}
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => removeMedia(activeMediaIndex)}
                  className="absolute top-3 right-3 p-1.5 rounded-xl"
                  title="Remove this photo"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {/* Thumbnails & Reorder Bar */}
              {mediaList.length > 1 && (
                <div className={`flex items-center gap-2 overflow-x-auto p-1.5 styled-scrollbar ${COLOR.canvasSurface} border border-edge rounded-lg`}>
                  {mediaList.map((m, idx) => (
                    <div
                      key={m.id}
                      onClick={() => setActiveMediaIndex(idx)}
                      className={`relative w-14 h-14 rounded-md overflow-hidden shrink-0 border cursor-pointer transition duration-150 active:scale-(--scale-press-sm) ${activeMediaIndex === idx ? 'border-edge ring-1 ring-white' : 'border-edge opacity-60 hover:opacity-100'
                        }`}
                    >
                      {m.isVideoPage ? (
                        <span className="w-full h-full flex items-center justify-center bg-glass-w12 text-retro-fg text-xs font-black">▶</span>
                      ) : itemLooksVideo(m) ? (
                        <video src={m.previewUrl} muted className="w-full h-full object-cover" />
                      ) : (
                        <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                      )}
                      <span className="absolute bottom-0.5 right-0.5 px-1 bg-black/70 text-2xs font-bold text-retro-fg rounded">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center gap-1 pl-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex - 1)}
                      disabled={activeMediaIndex === 0}
                      className="px-2 py-1 font-mono"
                      title="Move photo left"
                    >
                      ←
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex + 1)}
                      disabled={activeMediaIndex === mediaList.length - 1}
                      className="px-2 py-1 font-mono"
                      title="Move photo right"
                    >
                      →
                    </Button>
                  </div>
                </div>
              )}



              {/* Location & Tags are post metadata; a story carries no text. */}
              {mode !== 'story' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className={FIELD.shell}>
                  <MapPin className="w-4 h-4 text-retro-muted shrink-0" />
                  <Input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    bare
                  />
                </div>

                <div className={FIELD.shell}>
                  <Tag className="w-4 h-4 text-retro-muted shrink-0" />
                  <Input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags (e.g. anime, art, arcade)"
                    bare
                  />
                </div>
              </div>
              )}
            </div>
          )}
            </div>
          </div>
          )}
        </div>
      </div>
      {cropper}
      {mediaPickerEl}
    </div>
  );
}
