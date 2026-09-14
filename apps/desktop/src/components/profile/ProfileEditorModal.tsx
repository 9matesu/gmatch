"use client";

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { playPress, playWin } from '../../utils/sounds';
import { X, Camera, Globe, Lock, Plus } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { MAX_TAGS } from '@orbit/shared';
import { saveUserProfile, addRemovedProfileTag, clearRemovedProfileTag } from '../../utils/profile';
import { resolveMediaUrl } from '../../utils/media';
import { ProfilePicModal } from './ProfilePicModal';

export function ProfileEditorModal({
  identity,
  initialName = '',
  initialBio = '',
  initialWebsite = '',
  initialPfp = '',
  initialTags = [],
  onClose,
  onProfileUpdated,
  toast,
}: {
  identity: OrbitIdentity | null;
  initialName?: string;
  initialBio?: string;
  initialWebsite?: string;
  initialPfp?: string;
  initialTags?: string[];
  onClose: () => void;
  onProfileUpdated?: (updated: { name: string; bio: string; website: string; pfpUrl?: string; tags?: string[] }) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [website, setWebsite] = useState(initialWebsite);
  const [pfpUrl, setPfpUrl] = useState(initialPfp);
  const [tags, setTags] = useState<string[]>(() => [...initialTags]);
  const [tagDraft, setTagDraft] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPicModal, setShowPicModal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const commitTagDraft = () => {
    const norm = tagDraft
      .trim()
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 20);
    setTagDraft('');
    if (!norm) return;
    if (tags.includes(norm)) {
      toast?.('Tag is already on your profile', 'info');
      return;
    }
    if (tags.length >= MAX_TAGS) {
      toast?.(`At most ${MAX_TAGS} tags`, 'warning');
      return;
    }
    playPress(600);
    setTags((prev) => [...prev, norm]);
  };

  const removeTag = (tag: string) => {
    playPress(500);
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) {
      toast?.('Display name is required', 'warning');
      return;
    }

    setSaving(true);
    playPress(850);

    try {      let persistedPfp = pfpUrl.trim();
      if (persistedPfp.startsWith('blob:')) {
        const blob = await fetch(persistedPfp).then((res) => res.blob());
        persistedPfp = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }

      if (identity) {
        const patch: Parameters<typeof saveUserProfile>[1] = {
          display_name: name.trim(),
        };
        if (bio !== undefined) patch.bio = bio.trim();
        if (website !== undefined) patch.website = website.trim();
        if (persistedPfp) patch.pfp_url = persistedPfp;
        patch.tags = [...tags];

        const res = await saveUserProfile(identity, patch);
        if (!res.ok) throw new Error(res.error || `Profile save failed (${res.status})`);
        // Adopt the server ref (avatar uploads rewrite data: → /api/objects/<id>).
        if (typeof res.pfpUrl === 'string' && res.pfpUrl) persistedPfp = res.pfpUrl;

        // Removal-sticks bookkeeping: deleted tags must not resurface via the
        // post-tag auto-sync; re-added tags leave the removal list.
        const before = new Set(initialTags);
        const after = new Set(tags);
        for (const t of before) if (!after.has(t)) addRemovedProfileTag(t);
        for (const t of after) clearRemovedProfileTag(t);
        try {
          localStorage.setItem('orbit_tags', JSON.stringify([...tags]));
        } catch { /* private mode */ }
      }

      playWin();
      toast?.('Profile updated', 'success');
      onProfileUpdated?.({
        name: name.trim(),
        bio: bio.trim(),
        website: website.trim(),
        pfpUrl: persistedPfp || undefined,
        tags: [...tags],
      });
      onClose();
    } catch (err: any) {
      toast?.(err?.message || 'Could not save profile changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface-raised border border-border-glass rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-retro-muted hover:text-retro-body rounded cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-retro-fg">Edit Profile</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs font-medium text-retro-accent hover:text-retro-accent-hover cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Done'}
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4 styled-scrollbar">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 pb-2">
            <div
              className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-border-glass cursor-pointer group"
              onClick={() => setShowPicModal(true)}
            >
              {pfpUrl ? (
                <img src={resolveMediaUrl(pfpUrl)} alt="Avatar" className="w-full h-full object-cover" onError={() => setPfpUrl('')} />
              ) : (
                <div className="w-full h-full bg-surface-interactive flex items-center justify-center text-xl font-medium text-retro-muted">
                  {(name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-5 h-5" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPicModal(true)}
              className="text-xs text-retro-accent hover:text-retro-accent-hover cursor-pointer"
            >
              Change photo
            </button>
          </div>

          {/* Form Fields */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-retro-body block mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                maxLength={40}
                required
                className="w-full bg-surface-interactive border border-border-glass rounded-lg px-3 py-2 text-sm text-retro-fg focus:outline-none focus:border-retro-accent transition-colors placeholder:text-retro-muted"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-retro-body block mb-1.5">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Write a pornified bio... What do you like?"
                rows={3}
                maxLength={150}
                className="w-full bg-surface-interactive border border-border-glass rounded-lg p-3 text-sm text-retro-fg focus:outline-none focus:border-retro-accent transition-colors resize-none placeholder:text-retro-muted"
              />
              <div className="text-right text-xs text-retro-muted mt-0.5">
                {bio.length}/150
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-retro-body block mb-1.5">Favorite Website</label>
              <div className="flex items-center gap-2 bg-surface-interactive border border-border-glass rounded-lg px-3 py-2">
                <Globe className="w-4 h-4 text-retro-muted shrink-0" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://pmvhaven.com"
                  className="w-full bg-transparent focus:outline-none text-sm text-retro-fg placeholder:text-retro-muted"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-retro-body block mb-1.5">
                Tags <span className="text-retro-muted font-normal">· {tags.length}/{MAX_TAGS} · drive your feed</span>
              </label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-glass-w12 border border-border-glass text-xs font-semibold text-retro-fg"
                    >
                      #{t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        aria-label={`Remove tag ${t}`}
                        className="p-0.5 rounded-full text-retro-muted hover:text-rose-400 hover:bg-glass-w12 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      commitTagDraft();
                    }
                  }}
                  placeholder={tags.length >= MAX_TAGS ? `Tag limit reached (${MAX_TAGS})` : 'Add a tag...'}
                  disabled={tags.length >= MAX_TAGS}
                  maxLength={20}
                  className="flex-1 bg-surface-interactive border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent transition-colors disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={commitTagDraft}
                  disabled={tags.length >= MAX_TAGS || !tagDraft.trim()}
                  aria-label="Add tag"
                  className="p-2 bg-surface-interactive hover:bg-glass-w12 border border-border-glass rounded-lg text-retro-muted hover:text-retro-fg transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-border-glass">
              <label className="flex items-center justify-between p-3 rounded-lg bg-surface-interactive border border-border-glass cursor-pointer select-none">
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-retro-muted" />
                  <div>
                    <span className="text-xs font-medium text-retro-body block">Private account [WIP]</span>
                    <span className="text-xs text-retro-muted">Only approved followers can view your feed</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="w-4 h-4 accent-retro-accent rounded cursor-pointer"
                />
              </label>
            </div>
          </div>
        </form>
      </div>

      <ProfilePicModal
        isOpen={showPicModal}
        currentPfp={pfpUrl}
        onClose={() => setShowPicModal(false)}
        onSave={(newPfp) => {
          setPfpUrl(newPfp);
        }}
        toast={toast}
      />
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
