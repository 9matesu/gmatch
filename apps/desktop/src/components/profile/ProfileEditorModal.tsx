"use client";

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { playPress } from '../../utils/sounds';
import { X, Camera, Globe, Plus } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { MAX_TAGS } from '@orbit/shared';
import { saveUserProfile, addRemovedProfileTag, clearRemovedProfileTag } from '../../utils/profile';
import { resolveMediaUrl } from '../../utils/media';
import { Button, Input, Textarea } from '../../ui/kit';
import {
  classes, COLOR, FIELD, GAP, ICON, PADDING, PADDING_X, PADDING_Y,
  RADIUS, SHADOW, TYPE, WEIGHT,
} from '../../ui/tokens';
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
          localStorage.setItem('orbit_display_name', name.trim());
          localStorage.setItem('orbit_bio', bio?.trim() ?? '');
          localStorage.setItem('orbit_website', website?.trim() ?? '');
        } catch { /* private mode */ }
      } else {
        // A save with no local key cannot be signed, so nothing reaches the
        // server. The old code toasted 'Profile updated' anyway and closed the
        // sheet, so the edit looked saved until the next restart. Fail loud.
        throw new Error('Not signed in, so the profile change was not saved.');
      }

      playPress(800);
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
      className={classes(
        'fixed inset-0 z-[var(--z-modal)] backdrop-blur-sm flex items-center justify-center',
        'font-sans animate-orbit-fade-in',
        COLOR.scrim, PADDING[4], COLOR.fg,
      )}
    >
      <div
        className={classes(
          'w-full max-w-md overflow-hidden flex flex-col max-h-(--max-h-dialog-sm) animate-orbit-pop',
          COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.control, SHADOW.modal,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={classes('flex items-center justify-between border-b', PADDING_X[4], PADDING_Y[3], COLOR.edge)}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close profile editor"
            className="p-1"
          >
            <X className="w-5 h-5" />
          </Button>
          <span className={classes(TYPE.sub, WEIGHT.medium, COLOR.fg)}>Edit Profile</span>
          <Button variant="link" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Done'}
          </Button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className={classes('flex-1 overflow-y-auto space-y-4 styled-scrollbar', PADDING[5])}>
          {/* Avatar */}
          <div className={classes('flex flex-col items-center pb-2', GAP[2])}>
            <div
              className={classes('relative w-20 h-20 overflow-hidden border-2 cursor-pointer group', RADIUS.pill, COLOR.edge)}
              onClick={() => setShowPicModal(true)}
            >
              {pfpUrl ? (
                <img src={resolveMediaUrl(pfpUrl)} alt="Avatar" className="w-full h-full object-cover" onError={() => setPfpUrl('')} />
              ) : (
                <div className={classes('w-full h-full flex items-center justify-center', COLOR.interactive, TYPE.display, WEIGHT.medium, COLOR.muted)}>
                  {(name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className={classes('absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center', COLOR.scrimSoft, COLOR.fg)}>
                <Camera className="w-5 h-5" />
              </div>
            </div>
            <Button variant="link" size="sm" onClick={() => setShowPicModal(true)}>
              Change photo
            </Button>
          </div>

          {/* Form Fields */}
          <div className="space-y-3">
            <div>
              <label htmlFor="profile-name" className={classes(TYPE.body, WEIGHT.medium, COLOR.body, 'block mb-1.5')}>Name</label>
              <Input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                maxLength={40}
                required
              />
            </div>

            <div>
              <label htmlFor="profile-bio" className={classes(TYPE.body, WEIGHT.medium, COLOR.body, 'block mb-1.5')}>Bio</label>
              <Textarea
                id="profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Write a pornified bio... What do you like?"
                rows={3}
                maxLength={150}
              />
              <div className={classes('text-right mt-0.5', TYPE.body, COLOR.muted)}>
                {bio.length}/150
              </div>
            </div>

            <div>
              <label htmlFor="profile-website" className={classes(TYPE.body, WEIGHT.medium, COLOR.body, 'block mb-1.5')}>Favorite Website</label>
              <div className={FIELD.shell}>
                <Globe className={classes(ICON.md, COLOR.muted, 'shrink-0')} />
                <Input
                  id="profile-website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://pmvhaven.com"
                  bare
                />
              </div>
            </div>

            <div>
              <span className={classes(TYPE.body, WEIGHT.medium, COLOR.body, 'block mb-1.5')}>
                Tags <span className={classes(COLOR.muted, WEIGHT.regular)}>· {tags.length}/{MAX_TAGS} · drive your feed</span>
              </span>
              {tags.length > 0 && (
                <div className={classes('flex flex-wrap mb-2', GAP[1.5])}>
                  {tags.map((t) => (
                    <span
                      key={t}
                      className={classes(
                        'inline-flex items-center pl-2.5 pr-1.5 py-1 border',
                        GAP[1], RADIUS.pill, COLOR.glassW12, COLOR.edge,
                        TYPE.body, WEIGHT.semibold, COLOR.fg,
                      )}
                    >
                      #{t}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTag(t)}
                        aria-label={`Remove tag ${t}`}
                        className="p-0.5 rounded-full"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              <div className={classes('flex items-center', GAP[2])}>
                <Input
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
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={commitTagDraft}
                  disabled={tags.length >= MAX_TAGS || !tagDraft.trim()}
                  aria-label="Add tag"
                  className="shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
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
