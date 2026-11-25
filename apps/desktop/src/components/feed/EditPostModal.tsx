"use client";

import { useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { MAX_POST_CAPTION } from '../../services/postEdit';

/**
 * Edit a post's caption.
 *
 * The caption is the author's own words, so the edit is owner-only (the
 * caller decides whether the "Edit" row is shown at all). The field is
 * prefilled with the current caption and capped at the protocol's limit
 * (2000 chars) — the node refuses anything longer, so the UI must not
 * pretend otherwise.
 */
export function EditPostModal({
  post,
  onClose,
  onSave,
  saving = false,
}: {
  post: { id: string; caption?: string | null };
  onClose: () => void;
  /** Receives the new caption. The caller owns the request + the toast. */
  onSave: (caption: string) => void;
  saving?: boolean;
}) {
  const [caption, setCaption] = useState(post.caption ?? '');

  useEffect(() => {
    setCaption(post.caption ?? '');
  }, [post.id, post.caption]);

  const trimmed = caption.trim();
  const unchanged = trimmed === (post.caption ?? '').trim();

  const submit = () => {
    if (saving || unchanged) return;
    onSave(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in select-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit post"
        className="bg-surface-raised w-full max-w-md rounded-xl border border-edge shadow-2xl overflow-hidden animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="flex items-center gap-2 text-xs font-bold text-retro-fg">
            <Pencil className="w-4 h-4" />
            <span>Edit post</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit post"
            className="p-1.5 rounded-full text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <label htmlFor="edit-post-caption" className="block text-2xs font-semibold uppercase tracking-wider text-retro-muted mb-1.5">
            Caption
          </label>
          <textarea
            id="edit-post-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={MAX_POST_CAPTION}
            rows={5}
            autoFocus
            className="w-full resize-y rounded-lg border border-edge bg-retro-bg px-3 py-2 text-sm text-retro-fg placeholder:text-retro-faint focus:border-retro-accent/60 focus:outline-none styled-scrollbar"
            placeholder="Say something…"
          />
          <p className="mt-1.5 text-2xs text-retro-muted text-right">
            {caption.length}/{MAX_POST_CAPTION}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || unchanged}
            className="px-3 py-1.5 rounded-md text-xs font-bold text-retro-bg bg-retro-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditPostModal;
