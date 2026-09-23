"use client";

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Camera, UploadCloud, Link as LinkIcon, X, Check } from 'lucide-react';
import { CameraCapture } from '../CameraCapture';
import { DropZone } from '../DropZone';
import { useCropper } from '../../hooks/useCropper';
import { isCropableImage } from '../CropModal';
import { fileToThumbDataUrl } from '../../utils/profile';
import { playPress } from '../../utils/sounds';

interface ProfilePicModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPfp?: string;
  onSave: (pfpUrl: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ProfilePicModal({
  isOpen,
  onClose,
  currentPfp = '',
  onSave,
  toast,
}: ProfilePicModalProps) {
  const [tab, setTab] = useState<'upload' | 'url' | 'camera'>('upload');
  const [preview, setPreview] = useState<string>(currentPfp);
  const [urlInput, setUrlInput] = useState('');
  const [rawFile, setRawFile] = useState<File | null>(null);
  const { crop, cropper } = useCropper();

  useEffect(() => {
    if (isOpen) {
      setPreview(currentPfp);
      setUrlInput('');
      setRawFile(null);
      setTab('upload');
    }
  }, [isOpen, currentPfp]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    let file = files[0];
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: '1:1', title: 'Crop profile photo' });
      if (!res) return;
      if (res.file) file = res.file;
      setRawFile(file);
      setPreview(res.dataUrl);
    } else {
      setRawFile(file);
      setPreview(URL.createObjectURL(file));
    }
    playPress(750);
  };

  const handleUrlChange = (val: string) => {
    setUrlInput(val);
    if (val.trim()) {
      setPreview(val.trim());
      setRawFile(null);
    }
  };

  const handleCameraCapture = async (file: File) => {
    let target = file;
    let previewOut = URL.createObjectURL(file);
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: '1:1', title: 'Crop profile photo' });
      if (!res) return;
      if (res.file) target = res.file;
      previewOut = res.dataUrl;
    }
    setRawFile(target);
    setPreview(previewOut);
    setTab('upload');
    playPress(800);
  };

  const handleConfirm = async () => {
    if (!preview) {
      toast?.('Please select a profile photo', 'warning');
      return;
    }
    let finalUrl = preview;
    // Crop remote URLs too if changed (falls back to the original when CORS taints).
    if (preview !== currentPfp && /^https?:\/\//i.test(preview)) {
      const res = await crop(preview, { aspect: '1:1', title: 'Crop profile photo' });
      if (!res) return;
      finalUrl = res.dataUrl;
    }
    // Persist a compact 256px JPEG thumbnail (same helper onboarding uses):
    // blob: dies on reload and MB-scale data URLs bloat every lobby/users
    // payload — both were the "pfp not appearing in lobby" bug.
    if (rawFile) {
      try {
        finalUrl = await fileToThumbDataUrl(rawFile);
      } catch {
        /* keep the cropped preview if thumbnailing fails */
      }
    } else if (/^(data:|blob:)/.test(finalUrl)) {
      try {
        const blob = await fetch(finalUrl).then((r) => r.blob());
        finalUrl = await fileToThumbDataUrl(new File([blob], 'pfp.jpg', { type: blob.type }));
      } catch {
        /* keep the original when conversion fails */
      }
    }
    playPress(800);
    onSave(finalUrl);
    toast?.('Profile photo updated', 'success');
    onClose();
  };

  const tabs = [
    { id: 'upload', label: 'Upload', icon: UploadCloud },
    { id: 'url', label: 'URL', icon: LinkIcon },
    { id: 'camera', label: 'Camera', icon: Camera },
  ];

  const modalContent = (
    <div
      className="fixed inset-0 z-[var(--z-lightbox)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg"
    >
      <div
        className="w-full max-w-md bg-surface-raised border border-border-glass rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <h3 className="text-sm font-medium text-retro-fg">Profile photo</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-retro-muted hover:text-retro-body rounded cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 styled-scrollbar">
          {/* Avatar Preview */}
          <div className="flex flex-col items-center gap-1.5 py-2">
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-border-glass bg-surface-interactive flex items-center justify-center">
              {preview ? (
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl text-retro-muted">?</span>
              )}
            </div>
            {preview && (
              <button
                type="button"
                onClick={async () => {
                  const target = rawFile || preview;
                  const res = await crop(target, { aspect: '1:1', title: 'Crop profile photo' });
                  if (!res) return;
                  if (res.file) setRawFile(res.file);
                  setPreview(res.dataUrl);
                }}
                className="text-[10px] text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
              >
                Adjust crop
              </button>
            )}
          </div>

          {/* Mode Tabs */}
          <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id as any)}
                  className={`flex-1 py-2 rounded flex items-center justify-center gap-1.5 font-medium transition-colors cursor-pointer ${
                    isActive ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Body */}
          {tab === 'upload' && (
            <DropZone
              onFiles={handleFiles}
              compact={false}
              accept="image/jpeg, image/png, image/webp, image/gif, image/*"
              multiple={false}
            >
              <div className="space-y-1 text-center py-4">
                <p className="text-xs text-retro-body font-medium">Drop image here</p>
                <p className="text-xs text-retro-muted">JPG, PNG, WebP, GIF</p>
              </div>
            </DropZone>
          )}

          {tab === 'url' && (
            <div className="space-y-3">
              <label className="text-xs font-medium text-retro-body block">Image URL</label>
              <div className="flex items-center gap-2 bg-surface-interactive border border-border-glass rounded-lg px-3 py-2">
                <LinkIcon className="w-4 h-4 text-retro-muted shrink-0" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleUrlChange(urlInput);
                    }
                  }}
                  placeholder="https://example.com/photo.gif"
                  className="w-full bg-transparent focus:outline-none text-sm text-retro-fg font-mono placeholder:text-retro-muted"
                />
              </div>
            </div>
          )}

          {tab === 'camera' && (
            <CameraCapture onCapture={handleCameraCapture} onCancel={() => setTab('upload')} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-glass">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-retro-muted hover:text-retro-body rounded-lg cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs rounded-lg cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply</span>
          </button>
        </div>
      </div>
      {cropper}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
