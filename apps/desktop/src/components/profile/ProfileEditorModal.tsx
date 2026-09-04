"use client";

import { useState } from 'react';
import { playPress, playWin } from '../../utils/sounds';
import { X, Camera, Globe, Lock } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { saveUserProfile } from '../../utils/profile';
import { resolveMediaUrl } from '../../utils/media';
import { ProfilePicModal } from './ProfilePicModal';

export function ProfileEditorModal({
  identity,
  initialName = '',
  initialBio = '',
  initialWebsite = '',
  initialPfp = '',
  onClose,
  onProfileUpdated,
  toast,
}: {
  identity: OrbitIdentity | null;
  initialName?: string;
  initialBio?: string;
  initialWebsite?: string;
  initialPfp?: string;
  onClose: () => void;
  onProfileUpdated?: (updated: { name: string; bio: string; website: string; pfpUrl?: string }) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [website, setWebsite] = useState(initialWebsite);
  const [pfpUrl, setPfpUrl] = useState(initialPfp);
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPicModal, setShowPicModal] = useState(false);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) {
      toast?.('Display name is required', 'warning');
      return;
    }

    setSaving(true);
    playPress(850);

    try {
      let persistedPfp = pfpUrl.trim();
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
        const res = await saveUserProfile(identity, {
          display_name: name.trim(),
          bio: bio.trim(),
          website: website.trim(),
          ...(persistedPfp ? { pfp_url: persistedPfp } : {}),
        });
        if (!res.ok) throw new Error(`Profile save failed (${res.status})`);
      }

      playWin();
      toast?.('Profile updated', 'success');
      onProfileUpdated?.({
        name: name.trim(),
        bio: bio.trim(),
        website: website.trim(),
        pfpUrl: persistedPfp || undefined,
      });
      onClose();
    } catch {
      toast?.('Could not save profile changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md bg-surface-raised border border-retro-border rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-orbit-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-retro-border">
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
              className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-retro-border cursor-pointer group"
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

          <ProfilePicModal
            isOpen={showPicModal}
            currentPfp={pfpUrl}
            onClose={() => setShowPicModal(false)}
            onSave={(newPfp) => {
              setPfpUrl(newPfp);
            }}
            toast={toast}
          />

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
                className="w-full bg-surface-interactive border border-retro-border rounded-lg px-3 py-2 text-sm text-retro-fg focus:outline-none focus:border-retro-accent transition-colors placeholder:text-retro-muted"
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
                className="w-full bg-surface-interactive border border-retro-border rounded-lg p-3 text-sm text-retro-fg focus:outline-none focus:border-retro-accent transition-colors resize-none placeholder:text-retro-muted"
              />
              <div className="text-right text-[11px] text-retro-muted mt-0.5">
                {bio.length}/150
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-retro-body block mb-1.5">Favorite Website</label>
              <div className="flex items-center gap-2 bg-surface-interactive border border-retro-border rounded-lg px-3 py-2">
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

            <div className="pt-2 border-t border-retro-border">
              <label className="flex items-center justify-between p-3 rounded-lg bg-surface-interactive border border-retro-border cursor-pointer select-none">
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-retro-muted" />
                  <div>
                    <span className="text-xs font-medium text-retro-body block">Private account [WIP]</span>
                    <span className="text-[11px] text-retro-muted">Only approved followers can view your feed</span>
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
    </div>
  );
}
