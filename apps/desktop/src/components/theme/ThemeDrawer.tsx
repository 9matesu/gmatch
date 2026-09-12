import React, { useState, useEffect, useRef } from 'react';
import {
  PaintBrush,
  X,
  Upload,
  Image as ImageIcon,
  Sliders,
  ArrowsOut,
  Clock,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import type { AppSettings } from '../../hooks/useSettings';
import { playPress } from '../../utils/sounds';

export const WALLPAPER_PRESETS = [
  { id: 'default', name: 'Default', url: '' },
  { id: 'cyber', name: 'Cyber Grid', url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1920&q=80' },
  { id: 'lofi', name: 'Lofi Room', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1920&q=80' },
  { id: 'synth', name: 'Synthwave', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=1920&q=80' },
  { id: 'neon', name: 'Neon Rain', url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=1920&q=80' },
  { id: 'anime', name: 'Tokyo Night', url: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1920&q=80' },
  { id: 'minimal', name: 'Deep Space', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80' },
];

interface ThemeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'error') => void;
}

export function ThemeDrawer({ isOpen, onClose, settings, updateSettings, toast }: ThemeDrawerProps) {
  const [customUrlInput, setCustomUrlInput] = useState(settings.wallpaperUrl || '');
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomUrlInput(settings.wallpaperUrl || '');
  }, [settings.wallpaperUrl]);

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleWallpaperFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const mime = file.type || (isVideo ? 'video/mp4' : 'image/jpeg');

    if (isVideo) {
      const blobUrl = URL.createObjectURL(file);
      updateSettings('wallpaperUrl', blobUrl);
      updateSettings('wallpaperPreset', 'custom-file');
      updateSettings('wallpaperMime', mime);
      updateSettings('wallpaperSlideshow', false);
      setCustomUrlInput(file.name);
      toast?.('Video wallpaper applied', 'success');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const maxDim = 1920;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          updateSettings('wallpaperUrl', reader.result as string);
        } else {
          ctx.drawImage(img, 0, 0, width, height);
          updateSettings('wallpaperUrl', canvas.toDataURL('image/jpeg', 0.88));
        }
        updateSettings('wallpaperPreset', 'custom-file');
        updateSettings('wallpaperMime', 'image/jpeg');
        updateSettings('wallpaperSlideshow', false);
        setCustomUrlInput(file.name);
        toast?.('Custom wallpaper applied', 'success');
      };
      img.onerror = () => {
        updateSettings('wallpaperUrl', reader.result as string);
        updateSettings('wallpaperPreset', 'custom-file');
        updateSettings('wallpaperMime', mime);
        updateSettings('wallpaperSlideshow', false);
        setCustomUrlInput(file.name);
        toast?.('Custom wallpaper applied', 'success');
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => toast?.('Could not read wallpaper file', 'error');
    reader.readAsDataURL(file);
  };

  const applyCustomUrl = () => {
    const url = customUrlInput.trim();
    if (!url) {
      clearWallpaper();
      return;
    }
    const isVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
    updateSettings('wallpaperUrl', url);
    updateSettings('wallpaperPreset', 'custom');
    updateSettings('wallpaperMime', isVideo ? 'video/mp4' : 'image/jpeg');
    updateSettings('wallpaperSlideshow', false);
    toast?.('Wallpaper URL updated', 'success');
  };

  const clearWallpaper = () => {
    updateSettings('wallpaperUrl', '');
    updateSettings('wallpaperPreset', 'default');
    updateSettings('wallpaperMime', '');
    updateSettings('wallpaperSlideshow', false);
    setCustomUrlInput('');
    toast?.('Wallpaper reset to default', 'info');
  };

  const panelOpacityVal = Math.round((settings.panelOpacity ?? 1) * 100);
  const glassBlurVal = Math.round((settings.glassBlur ?? 0.7) * 100);

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Theme quick settings"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[var(--z-modal)] w-[94vw] max-w-lg bg-surface-raised/95 border border-border-glass rounded-2xl shadow-2xl backdrop-blur-2xl p-4 sm:p-5 space-y-4 animate-sheet-up text-retro-fg"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border-glass">
        <div className="flex items-center gap-2">
          <PaintBrush className="w-4 h-4 text-retro-accent" />
          <h3 className="text-xs font-bold tracking-wide uppercase text-retro-fg">Theme &amp; Appearance</h3>
        </div>
        <button
          type="button"
          onClick={() => { playPress(700); onClose(); }}
          className="p-1 rounded-lg text-retro-muted hover:text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
          aria-label="Close theme settings"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sliders: Blur & Opacity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-surface-interactive/60 border border-border-subtle rounded-xl">
        {/* Panel Opacity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="theme-panel-opacity" className="text-[11px] font-medium text-retro-muted flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-retro-muted" /> Panel Opacity
            </label>
            <span className="text-xs font-mono font-bold text-retro-fg tabular-nums">{panelOpacityVal}%</span>
          </div>
          <input
            id="theme-panel-opacity"
            type="range"
            min={35}
            max={100}
            step={5}
            value={panelOpacityVal}
            onChange={(e) => updateSettings('panelOpacity', Number(e.target.value) / 100)}
            className="w-full accent-retro-accent cursor-pointer h-1.5 bg-surface-raised rounded-lg"
          />
        </div>

        {/* Glass Blur */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="theme-glass-blur" className="text-[11px] font-medium text-retro-muted flex items-center gap-1">
              <ImageIcon className="w-3.5 h-3.5 text-retro-muted" /> Glass Blur
            </label>
            <span className="text-xs font-mono font-bold text-retro-fg tabular-nums">{glassBlurVal}%</span>
          </div>
          <input
            id="theme-glass-blur"
            type="range"
            min={0}
            max={100}
            step={5}
            value={glassBlurVal}
            onChange={(e) => updateSettings('glassBlur', Number(e.target.value) / 100)}
            className="w-full accent-retro-accent cursor-pointer h-1.5 bg-surface-raised rounded-lg"
          />
        </div>
      </div>

      {/* Wallpaper Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-retro-muted uppercase tracking-wider">Wallpaper Presets</span>
          {settings.wallpaperUrl && (
            <button
              type="button"
              onClick={() => { playPress(750); clearWallpaper(); }}
              className="text-[10px] text-retro-muted hover:text-retro-fg flex items-center gap-1 cursor-pointer transition-colors"
            >
              <ArrowCounterClockwise className="w-3 h-3" /> Reset default
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
          {WALLPAPER_PRESETS.map((preset) => {
            const isSelected = settings.wallpaperPreset === preset.id || (!settings.wallpaperUrl && preset.id === 'default');
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  playPress(800);
                  updateSettings('wallpaperUrl', preset.url);
                  updateSettings('wallpaperPreset', preset.id);
                  updateSettings('wallpaperMime', '');
                  updateSettings('wallpaperSlideshow', false);
                  setCustomUrlInput(preset.url);
                }}
                className={`py-1.5 px-1 rounded-lg border text-[10px] font-medium truncate transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'bg-retro-accent text-retro-accent-text border-transparent font-bold shadow-xs'
                    : 'bg-surface-interactive/40 text-retro-muted border-border-subtle hover:text-retro-fg hover:bg-surface-interactive'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Upload & Direct URL */}
      <div className="space-y-2 pt-1 border-t border-border-glass">
        <div className="flex items-center gap-2">
          <label className="flex-1 border border-border-glass hover:border-retro-muted rounded-xl bg-surface-interactive/40 hover:bg-surface-interactive px-3 py-2 flex items-center justify-center gap-2 cursor-pointer transition-all">
            <Upload className="w-3.5 h-3.5 text-retro-muted" />
            <span className="text-xs font-medium text-retro-body">Upload Image / Video</span>
            <input type="file" accept="image/*,video/*" onChange={handleWallpaperFile} className="hidden" />
          </label>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={customUrlInput}
            onChange={(e) => setCustomUrlInput(e.target.value)}
            placeholder="Paste media URL (https://...)"
            className="flex-1 bg-surface-interactive/60 border border-border-subtle rounded-xl px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-retro-muted font-mono placeholder:text-retro-faint"
          />
          <button
            type="button"
            onClick={() => { playPress(800); applyCustomUrl(); }}
            className="px-3 py-1.5 bg-retro-accent hover:bg-retro-accent-hover text-retro-accent-text rounded-xl text-xs font-bold cursor-pointer transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Fit & Slideshow options */}
      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-1 text-[11px] text-retro-muted">
          <ArrowsOut className="w-3.5 h-3.5" />
          <span>Fit:</span>
          {(['cover', 'contain'] as const).map((fit) => (
            <button
              key={fit}
              type="button"
              onClick={() => { playPress(750); updateSettings('wallpaperFit', fit); }}
              className={`px-2 py-0.5 rounded capitalize text-[10px] font-medium transition-all cursor-pointer ${
                settings.wallpaperFit === fit
                  ? 'bg-retro-accent text-retro-accent-text font-bold'
                  : 'text-retro-muted hover:text-retro-fg'
              }`}
            >
              {fit}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            playPress(800);
            updateSettings('wallpaperSlideshow', !settings.wallpaperSlideshow);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium transition-all cursor-pointer ${
            settings.wallpaperSlideshow
              ? 'bg-retro-accent text-retro-accent-text border-transparent font-bold'
              : 'bg-surface-interactive/40 border-border-subtle text-retro-muted hover:text-retro-fg'
          }`}
        >
          <Clock className="w-3 h-3" />
          <span>Slideshow</span>
        </button>
      </div>
    </div>
  );
}
