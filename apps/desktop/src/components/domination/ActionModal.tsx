"use client";

import { useState } from 'react';
import { X, Send, Loader2, Sparkles, Layers, Sliders, Palette, FolderOpen } from 'lucide-react';
import { DOM_LIMITS, validateDomPayload } from '../../utils/dominationMesh';
import { selectionToFile } from '../media/picker';
import { useMediaPicker } from '../media/MediaPickerModal';

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
  const [inlineName, setInlineName] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [duration, setDuration] = useState(10);
  const [intensity, setIntensity] = useState(8);
  const [position, setPosition] = useState<'top' | 'center' | 'bottom' | 'left' | 'right'>('center');
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('large');
  const [color, setColor] = useState('#9FE3FF');
  const [isPublicCamera, setIsPublicCamera] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // B7: the shared picker replaces the raw URL box + device-file label.
  // popup_video stays URL-only — a picked local File has no URL a remote
  // peer could open; wallpaper/game_bg carry real bytes inline (≤4 MB).
  const { open: openMediaPicker, picker: mediaPickerEl } = useMediaPicker({
    accept: action === 'popup_video' ? ['video'] : ['image'],
    sources: action === 'popup_video' ? ['url'] : ['browse', 'upload', 'url'],
    title: action === 'popup_video' ? 'Pick a video URL' : 'Pick an image',
  });

  const takeSelection = async (sel: import('../media/picker').MediaSelection) => {
    setFormError(null);
    if (sel.kind === 'file') {
      if (sel.file.size > DOM_LIMITS.inlineImageMaxBytes) {
        setFormError(`That image is ${(sel.file.size / 1048576).toFixed(1)} MB — the inline limit is 4 MB. Pick a smaller one or paste a link.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setUrl(String(reader.result || ''));
        setInlineName(sel.file.name);
      };
      reader.onerror = () => setFormError('Could not read that file.');
      reader.readAsDataURL(sel.file);
      return;
    }
    // URL selection. A keepsake URL (idle-file:/blob:/vault schemes) points at
    // THIS machine's bytes — fetch them now and ride inline, like a file.
    if (!/^https?:/i.test(sel.url)) {
      const file = await selectionToFile(sel, 'keepsake');
      if (!file) {
        setFormError('That media could not be read from this device. Paste a public link instead.');
        return;
      }
      if (file.size > DOM_LIMITS.inlineImageMaxBytes) {
        setFormError(`That image is ${(file.size / 1048576).toFixed(1)} MB — the inline limit is 4 MB. Pick a smaller one or paste a link.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setUrl(String(reader.result || ''));
        setInlineName(file.name);
      };
      reader.onerror = () => setFormError('Could not read that file.');
      reader.readAsDataURL(file);
      return;
    }
    setUrl(sel.url);
    setInlineName(null);
  };

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
        if (!trimmed) {
          setFormError(action === 'popup_video' ? 'Paste a video URL first.' : 'Pick an image or paste a URL first.');
          return;
        }
        // Same schema the receiver enforces — fail loud here, never seal
        // something that would be dropped on their side. An inline data:image
        // (from the picker) crosses peers with no shared server.
        const checked = validateDomPayload(action, { url: trimmed, duration: duration * 1000 });
        if (!checked.ok) { setFormError(checked.reason); return; }
        payload = checked.payload;
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

  const field = "w-full glass-field rounded-md p-2.5 text-xs outline-none placeholder:text-retro-muted";

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans">
      <div
        className="glass-surface rounded-xl max-w-lg w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${actionTitle} settings`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md glass-inset flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-retro-muted" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-retro-fg">{actionTitle}</h3>
              {targetName && (
                <p className="text-xs text-retro-muted">to {targetName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1.5 rounded-md hover:bg-glass-w10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {needsUrl && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-retro-fg">
                {action === 'popup_video' ? 'Video (mp4/webm)' : 'Image'}
              </label>
              <button
                type="button"
                onClick={() => void openMediaPicker().then((sel) => { if (sel) void takeSelection(sel); })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                  formError ? 'border-retro-error' : 'border-border-glass hover:border-retro-accent'
                } bg-surface-interactive`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-retro-muted shrink-0" />
                <span className="text-[11px] text-retro-fg truncate">
                  {inlineName
                    ? `Inline: ${inlineName}`
                    : url
                      ? url.startsWith('data:')
                        ? 'Picked media (inline)'
                        : url
                      : action === 'popup_video'
                        ? 'Paste a video URL — picked with preview'
                        : 'From your media, this device, or a link'}
                </span>
              </button>
              {inlineName && (
                <p className="text-[10px] text-retro-muted">
                  Inline: {inlineName} — the image rides sealed in the request, so it reaches them with no shared server.
                </p>
              )}
              <p className="text-[10px] text-retro-muted">
                {action === 'popup_video'
                  ? 'Paste a direct https media link. Their client loads it straight.'
                  : 'From your media, this device, or a direct https link (picked images ride sealed to them, up to 4 MB).'}
              </p>
            </div>
          )}

          {needsText && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-retro-fg">Message</label>
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
            <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg glass-inset">
              <div>
                <label className="block text-[10px] text-retro-muted mb-1 flex items-center gap-1">
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
                <label className="block text-[10px] text-retro-muted mb-1 flex items-center gap-1">
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
                <label className="block text-[10px] text-retro-muted mb-1 flex items-center gap-1">
                  <Palette className="w-3 h-3" /> Color
                </label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-full h-[34px] glass-field rounded-md p-1 cursor-pointer"
                />
              </div>
            </div>
          )}

          {action === 'blur' && (
            <div className="p-3.5 rounded-lg glass-inset space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-retro-fg">Blur strength</label>
                <span className="font-mono text-retro-muted">{intensity}px</span>
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
            <div className="p-3.5 rounded-lg glass-inset space-y-2">
              <div className="flex justify-between items-center text-xs">
                <label className="font-medium text-retro-fg">Duration</label>
                <span className="font-mono text-retro-muted">{duration}s</span>
              </div>
              <input
                type="range"
                aria-label="Duration"
                min="3"
                max="60"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full accent-retro-accent cursor-pointer"
              />
            </div>
          )}

          {action === 'camera' && (
            <label className="flex items-start gap-3 p-3.5 rounded-lg glass-inset cursor-pointer">
              <input
                type="checkbox"
                checked={isPublicCamera}
                onChange={(e) => setIsPublicCamera(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-retro-accent rounded cursor-pointer shrink-0"
              />
              <div className="min-w-0">
                <div className="font-medium text-retro-fg text-xs">Ask for a public photo</div>
                <div className="text-xs text-retro-muted leading-snug mt-0.5">
                  Off: the snapshot goes only to you. Either way the target approves the capture, and
                  their consent decides whether public is even possible. If their OS blocks the camera,
                  this quietly fizzles &mdash; check your Outbox.
                </div>
              </div>
            </label>
          )}

          {formError && (
            <p className="text-xs text-rose-400" role="alert">{formError}</p>
          )}

          {/* Footer: honest cost line */}
          <div className="pt-1 flex items-center justify-between gap-2">
            <span className="text-xs text-retro-muted">
              {price != null
                ? <><span className="font-mono">{price} g$</span> charged only if the send is accepted.</>
                : 'Charged only if the send is accepted.'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="glass-action px-3.5 py-1.5 text-retro-muted font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="glass-action glass-action-primary px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{loading ? 'Sending…' : 'Send'}</span>
              </button>
            </div>
          </div>
        </form>
        {mediaPickerEl}
      </div>
    </div>
  );
}
