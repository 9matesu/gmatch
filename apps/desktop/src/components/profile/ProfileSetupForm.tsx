"use client";

import { useRef, useState } from 'react';
import { Camera, User, X, Plus, Tag } from 'lucide-react';
import { normalizeTags, MAX_TAG_LENGTH } from '@orbit/shared';
import { fileToThumbDataUrl, MAX_DISPLAY_NAME_LENGTH } from '../../utils/profile';
import { useCropper } from '../../hooks/useCropper';
import { isCropableImage } from '../CropModal';
import { playPress } from '../../utils/sounds';

/**
 * The single source of truth for the obligatory profile trio (name, tags,
 * profile picture). Used by both the frontpage signup and the onboarding
 * profile step so the fields, validations and thumbnail handling can never
 * diverge.
 */
export function ProfileSetupForm({
  name,
  onName,
  tags,
  onTags,
  pfpUrl,
  onPfp,
  suggestions = [],
}: {
  name: string;
  onName: (v: string) => void;
  tags: string[];
  onTags: (t: string[]) => void;
  pfpUrl: string;
  onPfp: (v: string) => void;
  /** Tag suggestions fed from the user's own in-game (post) tags. */
  suggestions?: string[];
}) {
  const [tagInput, setTagInput] = useState('');
  const [pfpError, setPfpError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { crop, cropper } = useCropper();

  const addTag = (raw: string) => {
    const cleaned = raw.trim().toLowerCase().replace(/^#/, '');
    if (!cleaned) return;
    const next = normalizeTags([...tags, cleaned]);
    onTags(next);
    setTagInput('');
  };

  const availableSuggestions = suggestions
    .map((t) => t.toLowerCase().replace(/^#/, ''))
    .filter((t) => t && !tags.includes(t));

  const handlePfpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: '1:1', title: 'Crop profile photo' });
      if (!res) return;
      if (res.file) file = res.file;
    }
    if (file.size > 3 * 1024 * 1024) {
      setPfpError('Profile picture must be under 3MB');
      return;
    }
    try {
      const dataUrl = await fileToThumbDataUrl(file);
      setPfpError('');
      onPfp(dataUrl);
    } catch {
      setPfpError('Could not read that image — try a JPG or PNG');
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-retro-accent">Your identity</p>
        <p className="text-sm text-retro-muted leading-relaxed max-w-md mx-auto">
          A display name, at least one tag and a profile picture are required before you can play.
          Your profile tags stay in sync with the tags you use on your posts in-game.
        </p>
      </div>

      {/* Profile picture */}
      <div className="flex flex-col items-center justify-center space-y-2">
        <div className="relative group">
          <div className="w-20 h-20 rounded-full p-[2px] bg-gradient-to-tr from-[#9fe3ff] via-[#d6c6ff] to-[#ffd6f0] shadow-[0_0_20px_rgba(159,227,255,0.15)] group-hover:scale-105 transition-transform">
            <div className="w-full h-full rounded-full bg-[#080A0D] overflow-hidden flex items-center justify-center border border-border-glass">
              {pfpUrl ? (
                <img src={pfpUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-7 h-7 text-retro-muted group-hover:text-retro-accent transition-colors" />
              )}
            </div>
          </div>
          {pfpUrl ? (
            <button
              type="button"
              onClick={() => { playPress(700); onPfp(''); }}
              aria-label="Remove photo"
              className="absolute -bottom-1 -right-1 bg-surface-elevated hover:bg-black text-white rounded-full p-1 border border-border-glass cursor-pointer shadow-sm transition-transform active:scale-95"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <div className="absolute -bottom-1 -right-1 bg-retro-accent text-black rounded-full p-1 border border-black/20 shadow-sm">
              <Plus className="w-3 h-3" />
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePfpUpload}
            className="hidden"
          />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-[11px] text-retro-accent hover:text-retro-accent-hover font-semibold cursor-pointer"
        >
          {pfpUrl ? 'Change profile picture' : 'Upload profile picture'}
        </button>
        {pfpError ? (
          <span className="text-[11px] text-red-400 font-semibold">{pfpError}</span>
        ) : (
          !pfpUrl && <span className="text-[11px] text-retro-muted font-medium">Required</span>
        )}
      </div>

      {/* Display name */}
      <div className="space-y-1.5 text-left">
        <label className="text-xs font-bold text-retro-body block">
          Display name <span className="text-retro-accent">*</span>
        </label>
        <div className="relative flex items-center">
          <User className="w-4 h-4 text-retro-muted absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. gooningperv, girlcockEnjoyer, or whatever"
            required
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            autoFocus
            className="w-full bg-surface-raised border border-border-glass focus:border-retro-accent/60 rounded-md pl-10 pr-4 py-3 text-xs text-retro-fg font-semibold placeholder:text-retro-muted outline-none transition-all"
          />
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-1.5 text-left">
        <label className="text-xs font-bold text-retro-body flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-retro-accent" />
          <span>Your tags <span className="text-retro-accent">*</span></span>
          <span className="text-[10px] text-retro-muted font-medium">({tags.length}/5)</span>
        </label>
        <div className="relative flex items-center">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(tagInput);
              } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                onTags(tags.slice(0, -1));
              }
            }}
            onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
            placeholder="Type a porn tag and press Enter"
            maxLength={MAX_TAG_LENGTH + 1}
            className="w-full bg-surface-raised border border-border-glass focus:border-retro-accent/60 rounded-md pl-3.5 pr-4 py-3 text-xs text-retro-fg font-semibold placeholder:text-retro-muted outline-none transition-all"
          />
        </div>
        {tags.length === 0 && (
          <p className="text-[11px] text-retro-muted">Add at least one tag to continue.</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => { playPress(700); onTags(tags.filter((t) => t !== tag)); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-retro-accent/15 border border-retro-accent/30 text-retro-accent text-[11px] font-bold cursor-pointer hover:bg-retro-accent/25 transition-colors"
              >
                #{tag}
                <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
        {availableSuggestions.length > 0 && tags.length < 5 && (
          <div className="space-y-1 pt-1">
            <span className="text-[10px] text-retro-muted font-semibold uppercase tracking-wider">From your posts in-game</span>
            <div className="flex flex-wrap gap-1.5">
              {availableSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => { playPress(700); addTag(tag); }}
                  className="px-2 py-1 rounded-md bg-surface-interactive border border-border-glass text-retro-body text-[11px] font-semibold cursor-pointer hover:border-retro-accent/50 hover:text-retro-fg transition-colors"
                >
                  + #{tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {cropper}
    </div>
  );
}