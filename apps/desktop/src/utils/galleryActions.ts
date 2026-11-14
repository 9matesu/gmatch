/**
 * Gallery action bridge.
 *
 * The shared media context menu (components/ContextMenuMedia.tsx) is rendered at
 * the app root and knows nothing about gallery state. A keepsake action is a
 * request: the gallery listens and runs it against its own store. One event,
 * one handler, no prop drilling through three shells.
 */

export const GALLERY_ACTION_EVENT = 'gmatch:gallery-action';

export type GalleryActionId = 'repost' | 'story' | 'card' | 'feature' | 'backdrop' | 'delete';

export interface GalleryActionDetail {
  action: GalleryActionId;
  keepsakeId: string;
  /** Only for `backdrop`: where the image should land. */
  target?: 'app' | 'os';
}

export function requestGalleryAction(detail: GalleryActionDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GalleryActionDetail>(GALLERY_ACTION_EVENT, { detail }));
}