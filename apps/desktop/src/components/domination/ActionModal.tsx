"use client";

import { useState } from 'react';
import { X, Send, Loader2, Sparkles, Layers, Sliders, Palette } from 'lucide-react';

interface ActionModalProps {
  action: string;
  actionTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
  loading?: boolean;
}

export function ActionModal({
  action,
  actionTitle,
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}: ActionModalProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(10);
  const [intensity, setIntensity] = useState(8);
  const [position, setPosition] = useState<'top' | 'center' | 'bottom' | 'left' | 'right'>('center');
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('large');
  const [color, setColor] = useState('#9FE3FF');
  const [isPublicCamera, setIsPublicCamera] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let payload: any = {};

    switch (action) {
      case 'wallpaper':
      case 'game_bg':
      case 'popup_video':
        if (!url.trim()) return;
        payload = { url: url.trim(), duration: duration * 1000 };
        break;
      case 'message':
        if (!text.trim()) return;
        payload = { text: text.trim(), duration: duration * 1000 };
        break;
      case 'text_overlay':
        if (!text.trim()) return;
        payload = {
          text: text.trim(),
          position,
          size,
          color,
          duration: duration * 1000,
        };
        break;
      case 'blur':
        payload = { intensity, duration: duration * 1000 };
        break;
      case 'camera':
        payload = { quality: 0.85, isPublic: isPublicCamera };
        break;
    }

    await onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 select-none animate-orbit-fade-in font-sans">
      <div className="glass-surface border border-border-glass rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-orbit-slide-up flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-glass flex items-center justify-between bg-surface-canvas/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-retro-fg">{actionTitle}</h3>
              <p className="text-[10px] text-retro-muted font-mono">Custom Action Parameters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1.5 rounded-xl hover:bg-surface-interactive transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {(action === 'wallpaper' || action === 'game_bg' || action === 'popup_video') && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-retro-fg">Media Resource URL</label>
              <input
                type="url"
                required
                placeholder={action === 'popup_video' ? 'https://example.com/video.mp4' : 'https://example.com/image.jpg'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-surface-interactive border border-border-glass rounded-xl p-2.5 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent transition-colors"
              />
            </div>
          )}

          {(action === 'message' || action === 'text_overlay') && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-retro-fg">Screen Message Content</label>
              <textarea
                required
                rows={3}
                placeholder="Enter text to render on target's screen..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full bg-surface-interactive border border-border-glass rounded-xl p-2.5 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent transition-colors resize-none"
              />
            </div>
          )}

          {action === 'text_overlay' && (
            <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl glass-panel border border-border-glass bg-surface-raised/30">
              <div>
                <label className="block text-[10px] font-bold text-retro-muted mb-1 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Position
                </label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as any)}
                  className="w-full bg-surface-interactive border border-border-glass rounded-lg p-2 text-xs text-retro-fg outline-none"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-retro-muted mb-1 flex items-center gap-1">
                  <Sliders className="w-3 h-3" /> Size
                </label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value as any)}
                  className="w-full bg-surface-interactive border border-border-glass rounded-lg p-2 text-xs text-retro-fg outline-none"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-retro-muted mb-1 flex items-center gap-1">
                  <Palette className="w-3 h-3" /> Glow Color
                </label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-full h-8 bg-surface-interactive border border-border-glass rounded-lg p-1 cursor-pointer"
                />
              </div>
            </div>
          )}

          {action === 'blur' && (
            <div className="p-3.5 rounded-2xl glass-panel border border-border-glass bg-surface-raised/30 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-bold text-retro-fg">Blur Strength</label>
                <span className="text-retro-accent font-mono font-bold">{intensity}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="24"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="w-full accent-retro-accent cursor-pointer"
              />
            </div>
          )}

          {action !== 'camera' && (
            <div className="p-3.5 rounded-2xl glass-panel border border-border-glass bg-surface-raised/30 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-bold text-retro-fg">Effect Duration</label>
                <span className="text-retro-accent font-mono font-bold">{duration}s</span>
              </div>
              <input
                type="range"
                min="3"
                max="60"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-retro-accent cursor-pointer"
              />
            </div>
          )}

          {action === 'camera' && (
            <label className="flex items-start gap-3 p-3.5 rounded-2xl glass-panel border border-border-glass bg-surface-raised/40 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublicCamera}
                onChange={(e) => setIsPublicCamera(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-retro-accent rounded cursor-pointer shrink-0"
              />
              <div className="min-w-0">
                <div className="font-bold text-retro-fg text-xs">Public Gallery Feed Upload</div>
                <div className="text-[11px] text-retro-muted leading-snug mt-0.5">
                  If unchecked, snapshot is sent privately to you. Target consent policy applies.
                </div>
              </div>
            </label>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex justify-end gap-2 border-t border-border-glass">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border-glass rounded-xl hover:bg-surface-interactive text-retro-muted hover:text-retro-fg font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 chrome-accent bg-retro-accent text-black font-black rounded-xl hover:brightness-110 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Send Action</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
