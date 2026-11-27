"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useMediaPicker } from '../media/MediaPickerModal';
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

/**
 * Profile photo = the SHARED media picker (browse / upload / URL) + crop, then
 * auto-save. There is no second modal: the picker IS the UI, and the cropper is
 * the apply step. Picking a file crops 1:1 and saves; a URL is cropped when CORS
 * allows and saved as-is otherwise.
 */
export function ProfilePicModal({
  isOpen,
  onClose,
  currentPfp = '',
  onSave,
  toast,
}: ProfilePicModalProps) {
  const { crop, cropper } = useCropper();
  const { open: openMediaPicker, picker: mediaPickerEl } = useMediaPicker({
    accept: ['image'],
    sources: ['browse', 'upload', 'url', 'camera'],
    title: 'Pick a profile photo',
  });

  // Persist a compact 256px JPEG (blob: dies on reload; MB data URLs bloat
  // every lobby/users payload — the old "pfp not appearing" bug).
  const finalize = useCallback(async (src: string, file?: File | null) => {
    let out = src;
    if (file) {
      try { out = await fileToThumbDataUrl(file); } catch { /* keep cropped */ }
    } else if (/^(data:|blob:)/.test(out)) {
      try {
        const blob = await fetch(out).then((r) => r.blob());
        out = await fileToThumbDataUrl(new File([blob], 'pfp.jpg', { type: blob.type }));
      } catch { /* keep original */ }
    }
    playPress(800);
    onSave(out);
    toast?.('Profile photo updated', 'success');
    onClose();
  }, [onSave, onClose, toast]);

  const handleFile = useCallback(async (file: File) => {
    let src = URL.createObjectURL(file);
    let out = file;
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: '1:1', title: 'Crop profile photo' });
      if (!res) return;
      if (res.file) out = res.file;
      src = res.dataUrl;
    }
    await finalize(src, out);
  }, [crop, finalize]);

  const pickMedia = useCallback(async () => {
    const sel = await openMediaPicker();
    if (!sel) return;
    if (sel.kind === 'file') void handleFile(sel.file);
    else void finalize(sel.url);
  }, [openMediaPicker, handleFile, finalize]);

  const pickRef = useRef(pickMedia);
  pickRef.current = pickMedia;

  useEffect(() => {
    if (isOpen) void pickRef.current();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return <>{mediaPickerEl}{cropper}</>;
}