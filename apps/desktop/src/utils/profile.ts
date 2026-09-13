import { normalizeTags, MAX_TAGS, MAX_TAG_LENGTH, isDefaultPeerName } from '@orbit/shared';
import { orbitFetch, invalidateCache } from './api';
import type { OrbitIdentity } from '@orbit/crypto';

export { MAX_TAGS, MAX_TAG_LENGTH };

export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_BIO_LENGTH = 150;
export const MAX_WEBSITE_LENGTH = 200;

/** The single shape the web client persists via /api/users/profile. */
export interface ProfilePatch {
  display_name?: string;
  tags?: string[];
  pfp_url?: string;
  bio?: string;
  website?: string;
}

/**
 * Single source of truth for saving the authenticated user's profile. Every
 * caller (onboarding, frontpage signup, profile editor, pfp handler, tags
 * auto-sync) goes through here so the PATCH payload shape and tag
 * normalization can never drift between call sites.
 */
export async function saveUserProfile(
  identity: OrbitIdentity,
  patch: ProfilePatch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const body: ProfilePatch = { ...patch };
  if (body.tags !== undefined) body.tags = normalizeTags(body.tags as (string | null | undefined)[]);
  const res = await orbitFetch('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, identity);
  let error: string | undefined;
  if (res.ok) {
    invalidateCache('/api/users');
  } else {
    try {
      const data = await res.json();
      error = data?.error || data?.message;
    } catch {
      error = `Profile save failed (HTTP ${res.status})`;
    }
  }
  return { ok: res.ok, status: res.status, error };
}

/**
 * Feed the profile tag picker / live profile tags from the tags the user
 * created on their own posts (their in-game activity) plus their currently
 * stored profile tags. Post tags are the live source; the stored profile tags
 * seed the list until the user starts posting. Normalized + capped by the
 * shared rule (the same one the server enforces).
 */
export function deriveProfileTags(
  ownPosts: Array<{ tags?: string[] | null }>,
  currentTags: string[] = [],
): string[] {
  const postTags: string[] = [];
  for (const post of ownPosts) {
    if (Array.isArray(post?.tags)) postTags.push(...post.tags);
  }
  return normalizeTags([...postTags, ...currentTags]);
}

/** A profile is only complete when non-default name, at least one tag and a picture exist. */
export function profileIsComplete(name: string, tags: string[], pfpUrl: string): boolean {
  return Boolean(name.trim()) && !isDefaultPeerName(name) && tags.length >= 1 && Boolean(pfpUrl.trim());
}

/** Downscale any local image to a compact 256x256 JPEG data URL for avatars. */
export function fileToThumbDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(String(reader.result || '')); return; }
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}