import type { User, OrbitObject } from '@orbit/shared';

export function areItemsStructurallyEqual(a: OrbitObject[], b: OrbitObject[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].content_url !== b[i].content_url ||
      a[i].is_favorited !== b[i].is_favorited ||
      a[i].caption !== b[i].caption
    ) return false;
  }
  return true;
}

export function areUsersStructurallyEqual(a: User[], b: User[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ua = a[i], ub = b[i];
    if (ua.id !== ub.id || ua.online !== ub.online || ua.display_name !== ub.display_name) return false;
    if (JSON.stringify(ua.tags || []) !== JSON.stringify(ub.tags || [])) return false;
  }
  return true;
}

export function areAnnouncementsStructurallyEqual(a: { id: string; message: string }[], b: { id: string; message: string }[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].message !== b[i].message) return false;
  }
  return true;
}