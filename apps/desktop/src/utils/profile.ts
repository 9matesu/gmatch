import { normalizeTags, MAX_TAGS, MAX_TAG_LENGTH, isDefaultPeerName } from '@orbit/shared';
import { orbitFetch, invalidateCache } from './api';
import type { OrbitIdentity } from '@orbit/crypto';

export { MAX_TAGS, MAX_TAG_LENGTH };

export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_BIO_LENGTH = 150;
export const MAX_WEBSITE_LENGTH = 200;

/** Upload a data: image as multipart bytes to /api/objects; returns the
 * private object ref the profile row stores ('/api/objects/<id>'). */
async function uploadAvatarBytes(identity: OrbitIdentity, dataUrl: string): Promise<string | null> {
  try {
    const blob = await fetch(dataUrl).then((r) => r.blob());
    if (!blob.size) return null;
    const ext = (blob.type.split('/')[1] || 'jpeg').split('+')[0];
    const form = new FormData();
    form.append('image', new File([blob], `avatar.${ext}`, { type: blob.type || 'image/jpeg' }));
    const res = await orbitFetch('/api/objects', { method: 'POST', body: form }, identity);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.id ? `/api/objects/${data.id}` : null;
  } catch {
    return null;
  }
}

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
): Promise<{ ok: boolean; status: number; error?: string; pfpUrl?: string }> {
  const body: ProfilePatch = { ...patch };
  if (body.tags !== undefined) body.tags = normalizeTags(body.tags as (string | null | undefined)[]);
  // Avatars above ~3KB of base64 ride a multipart BYTES upload first (the
  // signed-headers stream posts use), then the PATCH carries only the tiny
  // /api/objects/ ref. JSON bodies with data: URLs inflate the sealed request
  // header ~20x and the edge rejects them (403/431 on profile picture change).
  if (typeof body.pfp_url === 'string' && body.pfp_url.startsWith('data:image/') && body.pfp_url.length > 3072) {
    const uploaded = await uploadAvatarBytes(identity, body.pfp_url);
    if (!uploaded) return { ok: false, status: 0, error: 'Could not upload the profile picture' };
    body.pfp_url = uploaded;
  }
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
  // pfpUrl: the ref the server actually stored (an object upload rewrites
  // the data: URL to /api/objects/<id>; on failure it stays undefined).
  let pfpUrl: string | undefined
  if (res.ok && body.pfp_url !== undefined) {
    try { pfpUrl = ((await res.json()) as { pfp_url?: string })?.pfp_url ?? undefined } catch { /* keep optimistic */ }
  }
  return { ok: res.ok, status: res.status, error, pfpUrl };
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