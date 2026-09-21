"use client";

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { playPress } from '../../utils/sounds';
import { useCropper } from '../../hooks/useCropper';
import { isCropableImage } from '../CropModal';
import {
  X,
  MapPin,
  Tag,
  UploadCloud,
  Camera,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { orbitFetch } from '../../utils/api';
import { mediaUrlToCachedFile } from '../../utils/cacheMedia';
import { isMediaVideo, isTwitterUrl, isVideoPageUrl, isVideoPost, resolveTwitterMedia, resolveVideoMime, sniffFileHead, urlFallbackMime } from '../../utils/media';
import { forgeMediaLocally } from '../../services/mediaForge';
import { devFetchable } from '../../services/imageCache';

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
}: {
  identity: OrbitIdentity | null;
  onClose: () => void;
  onPostCreated?: (newPost: any) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  initialMedia?: PostMediaItem[];
  initialTags?: string;
  initialCaption?: string;
}) {
  const [activeTab, setActiveTab] = useState<'upload' | 'camera' | 'url'>('upload');
  const [mediaList, setMediaList] = useState<PostMediaItem[]>(() => initialMedia || []);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [caption, setCaption] = useState(initialCaption || '');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState(initialTags || '');
  const [aspectRatio, setAspectRatio] = useState<'square' | 'portrait' | 'landscape'>('square');
  const [uploading, setUploading] = useState(false);

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
    if (activeTab === 'camera') {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeTab]);

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

  const handleFilesSelected = async (files: FileList | null) => {
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

  const handleAddUrl = async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      toast?.('Paste a full https:// link', 'warning');
      return;
    }
    // Page URLs (X posts, watch pages) are not media bytes: resolve to a
    // direct file for an honest preview now; the server re-resolves at
    // share time as a second chance.
    if (isTwitterUrl(raw)) {
      setResolvingUrl(true);
      try {
        const direct = await resolveTwitterMedia(raw);
        if (direct) {
          setMediaList((prev) => [
            ...prev,
            { id: 'url_' + Date.now(), previewUrl: direct, originalUrl: raw, isExternalUrl: true },
          ]);
          toast?.('Attached media from post link', 'success');
        } else {
          setMediaList((prev) => [
            ...prev,
            { id: 'url_' + Date.now(), previewUrl: raw, isExternalUrl: true, isVideoPage: true, resolveNote: 'Preview not ready. It attaches on share.' },
          ]);
          toast?.('Kept the link. Media attaches when you share.', 'info');
        }
      } finally {
        setResolvingUrl(false);
      }
      setUrlInput('');
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
    setUrlInput('');
    playPress(840);
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

  const handleShare = async () => {
    if (!identity) {
      toast?.('Please sign in to share posts', 'error');
      return;
    }
    if (mediaList.length === 0) {
      toast?.('Please add at least one photo or video', 'warning');
      return;
    }

    setUploading(true);
    playPress(880);

    try {
      // Sequential uploads keep insertion order; one shared post_group turns
      // the N objects into a single coalesced post server-side. Only the
      // first row carries caption/location/tags.
      const postGroup = crypto.randomUUID();
      const ids: string[] = [];
      let primaryId = '';
      let primaryLocalUrl: string | null = null;
      let primaryMime: string | null = null;
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
                        blob = await requestSwarmObject(data.content_hash, 3000);
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

        if (uploadFile) {
          // Zero-media P2P path: seed locally into swarm and register metadata
          // with central server. Never sends raw binary bytes (which 422).
          const forged = await forgeMediaLocally(uploadFile, identity, {
            caption: i === 0 ? caption.trim() : undefined,
            postCaption: i === 0 ? caption.trim() : undefined,
            location: i === 0 ? location.trim() : undefined,
            tags: i === 0 ? tags.trim() : undefined,
            isPublic: true,
            postGroup,
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
          formData.append('is_public', '1');
          formData.append('post_group', postGroup);
          const fallbackMime = urlFallbackMime(item as any);
          if (!primaryMime) primaryMime = item.mimeType || fallbackMime;
          if (fallbackMime) {
            formData.append('mime_type', fallbackMime);
          }
          if (i === 0) {
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
      }
      const objectId = primaryId || 'post_' + Math.random().toString(36).substring(2, 9);
 
      playPress(800);
      toast?.('Post shared.', 'success');

      onPostCreated?.({
        id: objectId,
        author_id: identity.orbitId,
        author_name: 'You',
        author_avatar: null,
        url: primaryId ? `/api/objects/${primaryId}` : mediaList[0].previewUrl,
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

      onClose();
    } catch (err: any) {
      toast?.(err?.message || 'Failed to share post', 'error');
    } finally {
      setUploading(false);
    }
  };

  const currentMedia = mediaList[activeMediaIndex] || mediaList[0];

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 pb-[calc(0.75rem+var(--island-clearance))] sm:p-4 sm:pb-[calc(1rem+var(--island-clearance))] font-sans select-none animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-retro-panel border border-border-glass rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-var(--island-clearance)-2rem)] text-retro-fg animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-retro-muted hover:text-retro-fg rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <span className="font-semibold text-xs text-retro-fg">
            Create Post {mediaList.length > 0 ? `(${mediaList.length} media)` : ''}
          </span>

          <button
            type="button"
            onClick={handleShare}
            disabled={uploading || mediaList.length === 0}
            className="text-xs font-semibold text-retro-bg bg-white hover:bg-retro-fg disabled:opacity-40 cursor-pointer transition-all duration-150 active:scale-[0.96] px-4 py-1.5 rounded-md shadow-xs"
          >
            {uploading ? 'Sharing...' : 'Share'}
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center border-b border-border-glass px-3 pt-2 pb-2 gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('upload'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all duration-150 cursor-pointer font-medium ${activeTab === 'upload'
              ? 'bg-glass-w12 text-retro-fg'
              : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload / Files</span>
          </button>

          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('camera'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all duration-150 cursor-pointer font-medium ${activeTab === 'camera'
              ? 'bg-glass-w12 text-retro-fg'
              : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            <Camera className="w-4 h-4" />
            <span>Camera</span>
          </button>

          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('url'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all duration-150 cursor-pointer font-medium ${activeTab === 'url'
              ? 'bg-glass-w12 text-retro-fg'
              : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            <LinkIcon className="w-4 h-4" />
            <span>Paste URL / GIF</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 styled-scrollbar">
          {/* Active Tab Modalities */}
          {activeTab === 'upload' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border-glass hover:border-retro-accent rounded-xl bg-surface-interactive hover:bg-glass-w10 p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center group"
            >
              <UploadCloud className="w-8 h-8 text-retro-muted group-hover:text-retro-accent group-hover:scale-110 transition-transform" />
              <p className="text-xs font-bold text-retro-body">Drag &amp; drop photos or click to browse</p>
              <span className="text-[10px] text-retro-muted">Images and video, up to {MAX_MEDIA}. {mediaList.length}/{MAX_MEDIA} added</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={(e) => handleFilesSelected(e.target.files)}
                className="hidden"
              />
            </div>
          )}

          {activeTab === 'camera' && (
            <div className="border border-border-glass rounded-xl overflow-hidden bg-black p-2 flex flex-col items-center gap-3">
              {cameraError ? (
                <div className="p-6 text-center text-xs text-retro-error font-bold">
                  {cameraError}
                </div>
              ) : (
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-canvas flex items-center justify-center">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
              )}
              <button
                type="button"
                onClick={capturePhoto}
                className="px-5 py-2 rounded-xl chrome-accent text-black text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer active:scale-95 transition-all"
              >
                <Camera className="w-4 h-4" />
                <span>Snap Picture</span>
              </button>
            </div>
          )}

          {activeTab === 'url' && (
            <div className="bg-surface-interactive border border-border-glass p-3 rounded-xl flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste image, GIF, MP4, post, or video page URL"
                className="flex-1 px-3 py-2 bg-surface-raised border border-border-glass rounded-xl text-xs outline-none focus:border-retro-accent"
              />
              <button
                type="button"
                onClick={() => void handleAddUrl()}
                disabled={resolvingUrl}
                className="px-4 py-2 chrome-accent text-black rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-40"
              >
                {resolvingUrl ? '…' : 'Add'}
              </button>
            </div>
          )}

          {/* Carousel & Multi-Media Viewer */}
          {mediaList.length > 0 && currentMedia && (
            <div className="space-y-3">
              <div className="relative w-full rounded-xl overflow-hidden bg-black flex items-center justify-center border border-border-glass group">
                {currentMedia.isVideoPage ? (
                  <div className="w-full aspect-video flex flex-col items-center justify-center gap-2 p-4 text-center">
                    <span className="w-10 h-10 rounded-full bg-glass-w12 border border-border-glass flex items-center justify-center text-retro-fg text-xs font-black">▶</span>
                    <span className="text-xs font-semibold text-retro-fg">Video link attached</span>
                    <span className="text-[10px] text-retro-muted break-all max-w-full">
                      {(currentMedia.originalUrl || currentMedia.previewUrl).slice(0, 80)}
                    </span>
                    <span className="text-[10px] text-retro-muted">
                      {currentMedia.resolveNote || 'Media attaches when you share'}
                    </span>
                  </div>
                ) : (
                  <>
                    {itemLooksVideo(currentMedia) ? (
                      <video src={devFetchable(currentMedia.previewUrl) || currentMedia.previewUrl} muted playsInline className={`w-full object-cover ${aspectRatio === 'square' ? 'aspect-square' : aspectRatio === 'portrait' ? 'aspect-[4/5]' : 'aspect-[16/9]'}`} />
                    ) : null}
                    {!itemLooksVideo(currentMedia) && (
                    <img
                      src={devFetchable(currentMedia.previewUrl) || currentMedia.previewUrl}
                      alt=""
                      className={`w-full object-cover transition-all ${aspectRatio === 'square'
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
                <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md rounded-xl p-1 flex items-center gap-1 text-[10px] font-bold text-white z-10">
                  {(['square', 'portrait', 'landscape'] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`px-2 py-1 rounded-lg capitalize transition-all ${aspectRatio === ratio
                        ? 'bg-surface-raised text-retro-fg font-black'
                        : 'text-retro-body hover:text-white'
                        }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>

                {/* Left/Right Cycle Arrows */}
                {mediaList.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => { playPress(750); setActiveMediaIndex((prev) => (prev > 0 ? prev - 1 : mediaList.length - 1)); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center transition-all cursor-pointer"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { playPress(750); setActiveMediaIndex((prev) => (prev < mediaList.length - 1 ? prev + 1 : 0)); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center transition-all cursor-pointer"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* Delete Media Button */}
                <button
                  type="button"
                  onClick={() => removeMedia(activeMediaIndex)}
                  className="absolute top-3 right-3 p-1.5 rounded-xl bg-black/75 hover:bg-red-600 text-white transition-colors cursor-pointer"
                  title="Remove this photo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Thumbnails & Reorder Bar */}
              {mediaList.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto p-1.5 styled-scrollbar bg-retro-bg border border-border-glass rounded-lg">
                  {mediaList.map((m, idx) => (
                    <div
                      key={m.id}
                      onClick={() => setActiveMediaIndex(idx)}
                      className={`relative w-14 h-14 rounded-md overflow-hidden shrink-0 border cursor-pointer transition-all duration-150 active:scale-[0.96] ${activeMediaIndex === idx ? 'border-white ring-1 ring-white' : 'border-border-glass opacity-60 hover:opacity-100'
                        }`}
                    >
                      {m.isVideoPage ? (
                        <span className="w-full h-full flex items-center justify-center bg-glass-w12 text-retro-fg text-xs font-black">▶</span>
                      ) : itemLooksVideo(m) ? (
                        <video src={m.previewUrl} muted className="w-full h-full object-cover" />
                      ) : (
                        <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                      )}
                      <span className="absolute bottom-0.5 right-0.5 px-1 bg-black/70 text-[10px] font-bold text-white rounded">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center gap-1 pl-2">
                    <button
                      type="button"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex - 1)}
                      disabled={activeMediaIndex === 0}
                      className="px-2 py-1 bg-glass-w12 border border-border-glass rounded text-[10px] font-mono font-semibold disabled:opacity-30 hover:bg-glass-w20 cursor-pointer transition-all duration-150 active:scale-[0.96]"
                      title="Move photo left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex + 1)}
                      disabled={activeMediaIndex === mediaList.length - 1}
                      className="px-2 py-1 bg-glass-w12 border border-border-glass rounded text-[10px] font-mono font-semibold disabled:opacity-30 hover:bg-glass-w20 cursor-pointer transition-all duration-150 active:scale-[0.96]"
                      title="Move photo right"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}

              {/* Description / Caption */}
              <div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write a caption..."
                  rows={3}
                  maxLength={1000}
                  className="w-full bg-retro-bg border border-border-glass rounded-lg p-3 text-xs text-retro-fg focus:outline-none focus:border-border-glass transition-colors placeholder:text-retro-muted resize-none"
                />
                <div className="text-right text-[10px] font-mono text-retro-muted mt-0.5">
                  {caption.length}/1000
                </div>
              </div>

              {/* Location & Tags inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex items-center gap-2 bg-retro-bg border border-border-glass rounded-lg px-3 py-2 text-xs">
                  <MapPin className="w-4 h-4 text-retro-muted shrink-0" />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg"
                  />
                </div>

                <div className="flex items-center gap-2 bg-retro-bg border border-border-glass rounded-lg px-3 py-2 text-xs">
                  <Tag className="w-4 h-4 text-retro-muted shrink-0" />
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags (e.g. anime, art, arcade)"
                    className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {cropper && createPortal(cropper, document.body)}
    </div>
  );
}
