"use client";

import { useState } from 'react';
import { Send, Sparkles, Layers, Sliders, Palette, FolderOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, Checkbox, Caption, Modal, Select, Textarea } from '../../ui/kit';
import { COLOR, DIALOG_WIDTH, FIELD, MONO, STATUS, TYPE } from '../../ui/tokens';
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
  /** A mesh-known target is free on every lane; the confirm line agrees with
   *  the card instead of quoting a server price nobody will be charged. */
  freeViaMesh?: boolean;
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
  freeViaMesh = false,
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
    // The read is capped at the inline limit so an oversized keep is
    // abandoned mid-stream, not buffered to 400 MB and then refused.
    if (!/^https?:/i.test(sel.url)) {
      const file = await selectionToFile(sel, 'keepsake', { maxBytes: DOM_LIMITS.inlineImageMaxBytes });
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

  return (
    <Modal
      title={<span className="inline-flex items-center gap-2"><Sparkles className="size-3.5 text-retro-muted" aria-hidden="true" />{actionTitle}</span>}
      onClose={onClose}
      maxWidth={DIALOG_WIDTH.lg}
    >
      {/* One form, one caption, one cost line. Every error sits by its field. */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {targetName && <Caption>to {targetName}</Caption>}
        {formError && (
          <p className={cn(TYPE.body, STATUS.danger, 'text-pretty')} role="alert">{formError}</p>
        )}
        {needsUrl && (
          <div className="space-y-1.5">
            <div className={cn(TYPE.body, COLOR.fg, 'font-medium')}>
              {action === 'popup_video' ? 'Video (mp4/webm)' : 'Image'}
            </div>
            <Button
              variant="secondary"
              className={cn('w-full', formError ? STATUS.dangerEdge : '')}
              onClick={() => void openMediaPicker().then((sel) => { if (sel) void takeSelection(sel); })}
            >
              <FolderOpen className="size-3.5 text-retro-muted" aria-hidden="true" />
              <span className="truncate">
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
            </Button>
            {inlineName && (
              <Caption className="text-pretty">
                Inline: {inlineName} — the image rides sealed in the request, so it reaches them with no shared server.
              </Caption>
            )}
            <Caption className="text-pretty">
              {action === 'popup_video'
                ? 'Paste a direct https media link. Their client loads it straight.'
                : 'From your media, this device, or a direct https link (picked images ride sealed to them, up to 4 MB).'}
            </Caption>
          </div>
        )}

        {needsText && (
          <div className="space-y-1.5">
            <label htmlFor="domination-message" className={cn(TYPE.body, COLOR.fg, 'block font-medium')}>
              Message
            </label>
            <Textarea
              id="domination-message"
              rows={3}
              maxLength={action === 'text_overlay' ? 120 : 280}
              placeholder="What they will see…"
              value={text}
              onChange={(e) => { setText(e.target.value); setFormError(null); }}
            />
          </div>
        )}

        {action === 'text_overlay' && (
          <div className="grid grid-cols-3 gap-2.5 rounded-lg glass-inset p-3">
            <div>
              <label htmlFor="domination-position" className="mb-1 flex items-center gap-1 text-2xs text-retro-muted">
                <Layers className="size-3" aria-hidden="true" /> Position
              </label>
              <Select
                id="domination-position"
                value={position}
                onChange={(e) => setPosition(e.target.value as any)}
                className="w-full"
              >
                <option value="top">Top</option>
                <option value="center">Center</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </Select>
            </div>
            <div>
              <label htmlFor="domination-size" className="mb-1 flex items-center gap-1 text-2xs text-retro-muted">
                <Sliders className="size-3" aria-hidden="true" /> Size
              </label>
              <Select
                id="domination-size"
                value={size}
                onChange={(e) => setSize(e.target.value as any)}
                className="w-full"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </Select>
            </div>
            <div>
              <label htmlFor="domination-color" className="mb-1 flex items-center gap-1 text-2xs text-retro-muted">
                <Palette className="size-3" aria-hidden="true" /> Color
              </label>
              <input
                id="domination-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={cn(FIELD.base, 'h-9 w-full cursor-pointer p-1')}
              />
            </div>
          </div>
        )}

        {action === 'blur' && (
          <div className="space-y-2 rounded-lg glass-inset p-3.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="domination-blur" className="font-medium text-retro-fg">Blur strength</label>
              <span className={MONO}>{intensity}px</span>
            </div>
            <input id="domination-blur" type="range" min="2" max="24" value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="w-full cursor-pointer accent-retro-accent" />
          </div>
        )}

        {action !== 'camera' && (
          <div className="space-y-2 rounded-lg glass-inset p-3.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="domination-duration" className="font-medium text-retro-fg">Duration</label>
              <span className={MONO}>{duration}s</span>
            </div>
            <input id="domination-duration" type="range" aria-label="Duration" min="3" max="60" value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full cursor-pointer accent-retro-accent" />
          </div>
        )}

        {action === 'camera' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg glass-inset p-3.5">
            <Checkbox
              checked={isPublicCamera}
              onChange={(e) => setIsPublicCamera(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0">
              <span className={cn(TYPE.body, COLOR.fg, 'font-medium')}>Ask for a public photo</span>
              <span className={cn(TYPE.body, COLOR.muted, 'mt-0.5 block text-pretty')}>
                Off: the snapshot goes only to you. Either way the target approves the capture, and
                their consent decides whether public is even possible. If their OS blocks the camera,
                this quietly fizzles — check your Outbox.
              </span>
            </span>
          </label>
        )}

        {/* One cost line, one primary action. The cost is never guessed. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle pt-3">
          <span className={cn(TYPE.body, COLOR.muted, 'text-pretty')}>
            {freeViaMesh
              ? 'Nothing is charged.'
              : price != null
                ? <><span className={MONO}>{price} g$</span> charged only if the send is accepted.</>
                : 'Charged only if the send is accepted.'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" loading={loading} loadingLabel="Sending…">
              <Send className="size-3.5" aria-hidden="true" /> Send
            </Button>
          </div>
        </div>
      </form>
      {mediaPickerEl}
    </Modal>
  );
}
