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
  /** Context for the honest confirm line: who + how much. */
  targetName?: string;
  price?: number;
}

export function ActionModal({
  action,
  actionTitle,
  isOpen,
  onClose,
  onSubmit,
  loading = false,
  targetName,
  price,
}: ActionModalProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(10);
  const [intensity, setIntensity] = useState(8);
  const [position, setPosition] = useState<'top' | 'center' | 'bottom' | 'left' | 'right'>('center');
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('large');
  const [color, setColor] = useState('#9FE3FF');
  const [isPublicCamera, setIsPublicCamera] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const needsUrl = action === 'wallpaper' || action === 'game_bg' || action === 'popup_video';
  const needsText = action === 'message' || action === 'text_overlay';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let payload: any = {};

    switch (action) {
      case 'wallpaper':
      case 'game_bg':
      case 'popup_video': {
        const trimmed = url.trim();
        if (!trimmed) { setFormError('Paste an image or video URL first.'); return; }
        let ok = false;
        try {
          const u = new URL(trimmed);
          ok = u.protocol === 'http:' || u.protocol === 'https:';
        } catch { ok = false; }
        if (!ok) { setFormError('That is not a valid http(s) URL.'); return; }
        payload = { url: trimmed, duration: duration * 1000 };
        break;
      }
      case 'message':
        if (!text.trim()) { setFormError('Write the message first.'); return; }
        payload = { text: text.trim().slice(0, 280), duration: duration * 1000 };
        break;
      case 'text_overlay':
        if (!text.trim()) { setFormError('Write the banner text first.'); return; }
        payload = {
          text: text.trim().slice(0, 120),
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

    setFormError(null);
    await onSubmit(payload);
  };

  const field = "w-full bg-zinc-950/60 border border-zinc-800 rounded-md p-2.5 text-xs outline-none focus:border-zinc-600 placeholder:text-zinc-600";

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4 select-none font-sans" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${actionTitle} settings`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">{actionTitle}</h3>
              {targetName && (
                <p className="text-[11px] text-zinc-500">to {targetName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {needsUrl && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-medium text-zinc-300">
                {action === 'popup_video' ? 'Video URL (mp4/webm)' : 'Image URL'}
              </label>
              <input
                type="url"
                placeholder={action === 'popup_video' ? 'https://example.com/video.mp4' : 'https://example.com/image.jpg'}
                value={url}
                onChange={(e) => { setUrl(e.target.value); setFormError(null); }}
                className={field}
              />
              <p className="text-[10px] text-zinc-600">Paste a direct media link — their client loads it straight.</p>
            </div>
          )}

          {needsText && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-medium text-zinc-300">Message</label>
              <textarea
                rows={3}
                maxLength={action === 'text_overlay' ? 120 : 280}
                placeholder="What they will see…"
                value={text}
                onChange={(e) => { setText(e.target.value); setFormError(null); }}
                className={`${field} resize-none`}
              />
            </div>
          )}

          {action === 'text_overlay' && (
            <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg border border-zinc-800 bg-zinc-950/40">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Position
                </label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as any)}
                  className={`${field} p-2`}
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 flex items-center gap-1">
                  <Sliders className="w-3 h-3" /> Size
                </label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value as any)}
                  className={`${field} p-2`}
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 flex items-center gap-1">
                  <Palette className="w-3 h-3" /> Color
                </label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-full h-[34px] bg-zinc-950/60 border border-zinc-800 rounded-md p-1 cursor-pointer"
                />
              </div>
            </div>
          )}

          {action === 'blur' && (
            <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/40 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-zinc-300">Blur strength</label>
                <span className="font-mono text-zinc-400">{intensity}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="24"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="w-full accent-zinc-300 cursor-pointer"
              />
            </div>
          )}

          {action !== 'camera' && (
            <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/40 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-zinc-300">Duration</label>
                <span className="font-mono text-zinc-400">{duration}s</span>
              </div>
              <input
                type="range"
                min="3"
                max="60"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-zinc-300 cursor-pointer"
              />
            </div>
          )}

          {action === 'camera' && (
            <label className="flex items-start gap-3 p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/40 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublicCamera}
                onChange={(e) => setIsPublicCamera(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-zinc-300 rounded cursor-pointer shrink-0"
              />
              <div className="min-w-0">
                <div className="font-medium text-zinc-200 text-xs">Ask for a public photo</div>
                <div className="text-[11px] text-zinc-500 leading-snug mt-0.5">
                  Off: the snapshot goes only to you. Either way the target approves the capture, and
                  their consent decides whether public is even possible.
                </div>
              </div>
            </label>
          )}

          {formError && (
            <p className="text-[11px] text-rose-400" role="alert">{formError}</p>
          )}

          {/* Footer: honest cost line */}
          <div className="pt-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500">
              {price != null
                ? <><span className="font-mono">{price} g$</span> charged only if the send is accepted.</>
                : 'Charged only if the send is accepted.'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 border border-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-1.5 bg-zinc-100 text-zinc-900 font-semibold rounded-md hover:bg-white flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{loading ? 'Sending…' : 'Send'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
