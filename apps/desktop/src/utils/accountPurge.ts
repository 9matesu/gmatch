import { useGame } from '../game/store';
import { SAVE_KEY } from '../game/save';
import { clearImageCache } from '../services/imageCache';
import { removeSecureItem, removeAllScopedSecureItems, SECURE_KEYS } from './secure-storage';

/**
 * One-shot local trace wipe, run after the server confirms account deletion.
 * Order matters: revoke folder grants and reset the game store while its
 * state still exists, then clear caches, then nuke web storage and the
 * secure (OS credential) store.
 */
export async function purgeAllLocalTraces(): Promise<void> {
  // 1. Folder access grants (Electron main-process side keeps these).
  try {
    const sources = useGame.getState().customSources;
    for (const s of sources) {
      if (s.kind === 'folder' && s.folderId) {
        try {
          await window.gmatch?.customRemoveFolder?.(s.folderId);
        } catch { /* grant may already be gone — keep erasing */ }
      }
    }
  } catch { /* non-Electron host: nothing to revoke */ }

  // 2. Idle game state + persisted save.
  try {
    useGame.getState().resetGame();
  } catch { /* store already fresh */ }
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* storage gone */ }

  // 3. Picture caches: Electron main-process RAM + renderer session Map.
  //    (The module also destroys the legacy IndexedDB store on use.)
  await clearImageCache().catch(() => { /* best effort */ });
  // Domination wallpaper temp files (image content on disk, main-process side).
  try {
    await window.gmatch?.wallpaperCleanupFiles?.();
  } catch { /* non-Electron host */ }

  // 4. Every remaining web-storage key: settings, seen sets, onboarding,
  //    age gate, chats, pfps, gallery filters, tutorial flags — the lot.
  try {
    localStorage.clear();
  } catch { /* non-browser env */ }
  try {
    sessionStorage.clear();
  } catch { /* non-browser env */ }

  // 5. Secure store (Windows Credential Manager / dev file fallback).
  // SECURE_KEYS (DPAPI side) keeps growing (join password, threads, rooms…):
  // derive the wipe list from the single source of truth so a new secure key
  // can never be forgotten here (privacy review, T5).
  for (const key of ['orbit_key_saved', 'orbit_display_name', 'orbit_admin_pin_unlocked', ...SECURE_KEYS]) {
    try {
      removeSecureItem(key);
    } catch { /* already gone */ }
  }
  // Scoped variants (`orbit_rooms_v1:<orbitId>`, threads, prefs…) are only
  // reachable via the mirror — wipe by prefix so none can survive (T5 review).
  try {
    removeAllScopedSecureItems();
  } catch { /* already gone */ }
}
