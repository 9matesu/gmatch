"use client";

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { playPress, playWin } from '../../utils/sounds';
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

interface PostMediaItem {
  id: string;
  file?: File;
  previewUrl: string;
  isExternalUrl?: boolean;
}

export function CreatePostModal({
  identity,
  onClose,
  onPostCreated,
  toast,
}: {
  identity: OrbitIdentity | null;
  onClose: () => void;
  onPostCreated?: (newPost: any) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [activeTab, setActiveTab] = useState<'upload' | 'camera' | 'url'>('upload');
  const [mediaList, setMediaList] = useState<PostMediaItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'square' | 'portrait' | 'landscape'>('square');
  const [uploading, setUploading] = useState(false);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
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

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      let previewUrl = URL.createObjectURL(file);
      if (isCropableImage(file)) {
        const res = await crop(file, { aspect: '4:5', title: 'Crop post image' });
        if (!res) continue;
        if (res.file) file = res.file;
        previewUrl = res.dataUrl;
      }
      const newItem: PostMediaItem = { id: 'file_' + Date.now() + '_' + i, file, previewUrl };
      setMediaList((prev) => [...prev, newItem]);
    }
    playPress(800);
  };

  const handleAddUrl = () => {
    if (!urlInput.trim()) return;
    const newItem: PostMediaItem = {
      id: 'url_' + Date.now(),
      previewUrl: urlInput.trim(),
      isExternalUrl: true,
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
      const primaryItem = mediaList[0];
      let objectId = 'post_' + Math.random().toString(36).substring(2, 9);

      if (primaryItem.file) {
        const formData = new FormData();
        formData.append('image', primaryItem.file);
        formData.append('is_public', '1');
        formData.append('post_caption', caption.trim());
        formData.append('location', location.trim());
        formData.append('tags', tags.trim());

        const res = await orbitFetch('/api/objects', {
          method: 'POST',
          body: formData,
        }, identity);

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Post upload failed (${res.status})`);
        }
        const data = await res.json();
        objectId = data.id || objectId;
      } else if (primaryItem.isExternalUrl) {
        const formData = new FormData();
        formData.append('url', primaryItem.previewUrl);
        formData.append('is_public', '1');
        formData.append('post_caption', caption.trim());
        formData.append('location', location.trim());
        formData.append('tags', tags.trim());

        const res = await orbitFetch('/api/objects', {
          method: 'POST',
          body: formData,
        }, identity);

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Post upload failed (${res.status})`);
        }
        const data = await res.json();
        objectId = data.id || objectId;
      }

      playWin();
      toast?.('Post shared to gMatch!', 'success');

      onPostCreated?.({
        id: objectId,
        author_id: identity.orbitId,
        author_name: 'You',
        author_avatar: null,
        url: primaryItem.previewUrl,
        media_list: mediaList.map((m) => m.previewUrl),
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
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 font-sans select-none animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-zinc-100 animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-md cursor-pointer hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <span className="font-semibold text-xs text-zinc-200">
            Create Post {mediaList.length > 0 ? `(${mediaList.length} media)` : ''}
          </span>

          <button
            type="button"
            onClick={handleShare}
            disabled={uploading || mediaList.length === 0}
            className="text-xs font-semibold text-zinc-950 bg-white hover:bg-zinc-200 disabled:opacity-40 cursor-pointer transition-all duration-150 active:scale-[0.96] px-4 py-1.5 rounded-md shadow-xs"
          >
            {uploading ? 'Sharing...' : 'Share'}
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex border-b border-zinc-800 px-3 pt-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('upload'); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 border-b-2 transition-all cursor-pointer font-medium ${activeTab === 'upload'
              ? 'border-white text-white bg-zinc-800/40 rounded-t-md'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload / Files</span>
          </button>

          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('camera'); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 border-b-2 transition-all cursor-pointer font-medium ${activeTab === 'camera'
              ? 'border-white text-white bg-zinc-800/40 rounded-t-md'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <Camera className="w-4 h-4" />
            <span>Camera</span>
          </button>

          <button
            type="button"
            onClick={() => { playPress(750); setActiveTab('url'); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 border-b-2 transition-all cursor-pointer font-medium ${activeTab === 'url'
              ? 'border-white text-white bg-zinc-800/40 rounded-t-md'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
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
              className="border-2 border-dashed border-border-glass hover:border-retro-accent rounded-2xl bg-surface-interactive hover:bg-retro-accent/10 p-5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center group"
            >
              <UploadCloud className="w-8 h-8 text-retro-muted group-hover:text-retro-accent group-hover:scale-110 transition-transform" />
              <p className="text-xs font-bold text-retro-body">Drag &amp; drop photos or click to browse</p>
              <span className="text-[10px] text-retro-muted">Supports JPG, PNG, GIF, WebP (select multiple)</span>
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
            <div className="border border-border-glass rounded-2xl overflow-hidden bg-black p-2 flex flex-col items-center gap-3">
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
            <div className="bg-surface-interactive border border-border-glass p-3 rounded-2xl flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste direct image or GIF URL (e.g. https://...)"
                className="flex-1 px-3 py-2 bg-surface-raised border border-border-glass rounded-xl text-xs outline-none focus:border-retro-accent"
              />
              <button
                type="button"
                onClick={handleAddUrl}
                className="px-4 py-2 chrome-accent text-black rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Add
              </button>
            </div>
          )}

          {/* Carousel & Multi-Media Viewer */}
          {mediaList.length > 0 && currentMedia && (
            <div className="space-y-3">
              <div className="relative w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-border-glass group">
                <img
                  src={currentMedia.previewUrl}
                  alt=""
                  className={`w-full object-cover transition-all ${aspectRatio === 'square'
                    ? 'aspect-square'
                    : aspectRatio === 'portrait'
                      ? 'aspect-[4/5]'
                      : 'aspect-[16/9]'
                    }`}
                />

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
                <div className="flex items-center gap-2 overflow-x-auto p-1.5 styled-scrollbar bg-zinc-950 border border-zinc-800 rounded-lg">
                  {mediaList.map((m, idx) => (
                    <div
                      key={m.id}
                      onClick={() => setActiveMediaIndex(idx)}
                      className={`relative w-14 h-14 rounded-md overflow-hidden shrink-0 border cursor-pointer transition-all duration-150 active:scale-[0.96] ${activeMediaIndex === idx ? 'border-white ring-1 ring-white' : 'border-zinc-800 opacity-60 hover:opacity-100'
                        }`}
                    >
                      <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0.5 right-0.5 px-1 bg-black/70 text-[8px] font-mono font-bold text-white rounded">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center gap-1 pl-2">
                    <button
                      type="button"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex - 1)}
                      disabled={activeMediaIndex === 0}
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] font-mono font-semibold disabled:opacity-30 hover:bg-zinc-700 cursor-pointer transition-all duration-150 active:scale-[0.96]"
                      title="Move photo left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMedia(activeMediaIndex, activeMediaIndex + 1)}
                      disabled={activeMediaIndex === mediaList.length - 1}
                      className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] font-mono font-semibold disabled:opacity-30 hover:bg-zinc-700 cursor-pointer transition-all duration-150 active:scale-[0.96]"
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
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors placeholder:text-zinc-500 resize-none"
                />
                <div className="text-right text-[10px] font-mono text-zinc-500 mt-0.5">
                  {caption.length}/1000
                </div>
              </div>

              {/* Location & Tags inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs">
                  <MapPin className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className="w-full bg-transparent focus:outline-none placeholder:text-zinc-500 text-zinc-200"
                  />
                </div>

                <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs">
                  <Tag className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags (e.g. anime, art, arcade)"
                    className="w-full bg-transparent focus:outline-none placeholder:text-zinc-500 text-zinc-200"
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
