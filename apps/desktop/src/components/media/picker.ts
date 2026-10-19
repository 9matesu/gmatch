/**
 * B7: the one Media Picker contract shared by every media entry point
 * (CreatePostModal incl. story mode, ProfilePicModal, CreateCardModal,
 * ActionModal). The modal itself lives in MediaPickerModal.tsx; this module
 * holds only the types and the pure helpers so they stay unit-testable
 * without jsdom.
 *
 * A selection is a primitive every caller already consumes:
 *  - kind 'file' → a real File (+ object preview URL) for upload flows.
 *  - kind 'url'  → an http(s)/data:/blob: URL for link posts or for callers
 *    that fetch bytes themselves (selectionToFile).
 * No second cache: bytes stay where the vault/gallery/clipboard put them.
 */

export type MediaPickerSource = 'browse' | 'upload' | 'url' | 'clipboard';

export type MediaSelection =
  | { kind: 'url'; url: string; name?: string; source: MediaPickerSource }
  | { kind: 'file'; file: File; previewUrl: string; source: MediaPickerSource };

export type MediaPickerOptions = {
  /** Kinds of media the caller can consume. Default: images only. */
  accept?: Array<'image' | 'video'>;
  /** Which panes to show. Default: all three. */
  sources?: Array<'browse' | 'upload' | 'url'>;
  title?: string;
};

/** Extension fallbacks for videos without a usable MIME (browser quirk).
 *  GIF is deliberately absent: it is an image everywhere in this app. */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** True when the file matches the caller's accepted kinds. */
export function fileAccepted(file: File, accept: Array<'image' | 'video'>): boolean {
  const type = (file.type || '').toLowerCase();
  if (accept.includes('image') && type.startsWith('image/')) return true;
  if (accept.includes('video') && (type.startsWith('video/') || VIDEO_EXT.test(file.name))) return true;
  return false;
}

/** Cheap synchronous URL gate. Content itself is validated by rendering it. */
export function plausibleMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'data:' || protocol === 'blob:';
  } catch {
    return false;
  }
}

/** True when a URL looks like video (used to gate accepts in the URL pane). */
export function urlLooksLikeVideo(url: string): boolean {
  return VIDEO_EXT.test(url) || /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url);
}

/**
 * Convert any selection into a File for callers that need real bytes
 * (forge, server upload). 'file' selections pass through; URL selections
 * are fetched. Returns null when the bytes are unreachable — never throws.
 * This is the same keep→File conversion CreateCardModal already used for
 * drags, extracted so every entry point shares one implementation.
 */
export async function selectionToFile(sel: MediaSelection, fallbackName = 'media'): Promise<File | null> {
  if (sel.kind === 'file') return sel.file;
  try {
    const res = await fetch(sel.url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
    const name = sel.name || `${fallbackName}-${Date.now()}.${ext}`;
    return new File([blob], name, { type: blob.type || 'application/octet-stream' });
  } catch {
    return null;
  }
}
