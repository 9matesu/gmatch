"use client";

import { useState } from 'react';
import { X, Send, Loader2, Sparkles, Layers, Sliders, Palette, ImagePlus } from 'lucide-react';
import { DOM_LIMITS, validateDomPayload } from '../../utils/dominationMesh';

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
                {action === 'popup_video' ? 'Video URL (mp4/webm)' : 'Image URL'}
              </label>
              <input
                type="url"
                placeholder={action === 'popup_video' ? 'https://example.com/video.mp4' : 'https://example.com/image.jpg'}
                value={url}
                onChange={(e) => { setUrl(e.target.value); setInlineName(null); setFormError(null); }}
                className={field}
              />
              {action !== 'popup_video' && (
                <div className="space-y-1">
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-glass text-[10px] font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-colors">
                    <ImagePlus className="w-3 h-3" />
                    {inlineName ? 'Replace image' : 'Pick an image from this device'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        setFormError(null);
                        if (!file) return;
                        if (file.size > DOM_LIMITS.inlineImageMaxBytes) {
                          setInlineName(null);
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
                      }}
                    />
                  </label>
                  {inlineName && (
                    <p className="text-[10px] text-retro-muted">
                      Inline: {inlineName} — the image rides sealed in the request, so it reaches them with no shared server.
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-retro-muted">
                {action === 'popup_video'
                  ? 'Paste a direct https media link. Their client loads it straight.'
                  : 'Paste a direct https link, or pick a local image (rides sealed to them, up to 4 MB).'}
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
      </div>
    </div>
  );
}
