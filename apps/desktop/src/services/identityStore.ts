/**
 * The app's single source of truth for the player identity (plan A1).
 *
 * Before this module there were four independent `useIdentity()` instances
 * (App, notifications, settings/server tab) plus two raw `getSecureItem`
 * readers (idle game save slot, admin media). Each React instance had its own
 * `useState` and a one-shot mount effect, and nothing listened to
 * `orbit-identity-changed`, so every consumer but App permanently held the
 * identity it happened to mount with. This store is module-level: one load,
 * one value, one subscription, and mutations broadcast to every consumer.
 *
 * Persistence is unchanged: the serialized identity still rides
 * `secure-storage` (`getSecureItem`/`setSecureItem`) under `orbit_identity`,
 * which is the DPAPI-backed main-process KV in Electron and localStorage in
 * browser/dev mode. No plaintext credentials are introduced here.
 */
import { getSecureItem, setSecureItem, removeSecureItem } from '../utils/secure-storage';
import { generateIdentity, restoreIdentity, type OrbitIdentity } from '@orbit/crypto';
import { clearObjects } from '../utils/storage';
import { logger } from '../utils/logger';

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface ExportedIdentityPayload extends OrbitIdentity {
  displayName?: string;
  tags?: string[];
  version?: number;
  exportedAt?: string;
}

export const USER_STORAGE_KEYS = [
  'orbit_identity',
  'orbit_share_recent',
  'orbit_display_name',
  'orbit_tags',
  'orbit_pending_tags',
  'orbit_pfp_url',
  'orbit_chat_messages',
  'orbit_p2p_gallery',
  'orbit_p2p_known_peers',
  'goonmatch-friends',
  'goonmatch-blocked',
  'orbit_admin_pin_unlocked',
  'goonmail_name_prompt_dismissed',
  'goonmail_ribbon_dismissed',
  'goonmatch-relationships',
  'goonmatch-decisions',
  'orbit_key_saved',
  'goonmatch_pfps',
  'goonmatch-settings',
  'orbit_active_hack',
  'orbit_unlocked_store',
  'orbit_unlocked_stories',
];

export function wipeUserStorage() {
  if (typeof window === 'undefined') return;
  for (const key of USER_STORAGE_KEYS) {
    try { localStorage.removeItem(key); } catch {}
    removeSecureItem(key)
  }
  // Logout must restart the social flow at the server picker: wipe per-identity
  // onboarding progress and the chosen-server marker. (goonMatch_age_verified
  // intentionally survives — the 18+ confirmation is device-level.)
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('orbit_onboarding_v2:') || k.startsWith('orbit_tour_v1:') || k === 'gmatch.onboarding.serverUrl') localStorage.removeItem(k);
    }
  } catch { /* private mode */ }
}

export interface IdentityStoreState {
  identity: OrbitIdentity | null;
  /** True once the stored identity has been read (or found absent/invalid). */
  isLoaded: boolean;
  /**
   * Why the stored identity could not be used: `invalid` (corrupt JSON on
   * disk), `unavailable` (storage threw), or null when there was simply no
   * identity. Never used to keep a user logged in on the strength of bad data.
   */
  loadError: 'invalid' | 'unavailable' | null;
}

const EMPTY: IdentityStoreState = { identity: null, isLoaded: false, loadError: null };

let state: IdentityStoreState = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) {
    try { listener() } catch { /* a broken consumer must not break the rest */ }
  }
}

function setState(patch: Partial<IdentityStoreState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener) };
}

/** Stable snapshot for `useSyncExternalStore` (identity is never mutated in place). */
export function identitySnapshot(): IdentityStoreState {
  return state;
}

/** Non-React accessor (idle save slot, admin cells, swarm/deps helpers). */
export function getCurrentIdentity(): OrbitIdentity | null {
  return state.identity;
}

export function isIdentityLoaded(): boolean {
  return state.isLoaded;
}

let loadPromise: Promise<void> | null = null;

/**
 * Read the persisted identity exactly once. Idempotent and safe to call from
 * every consumer's mount effect; a resolved identity is NEVER overwritten by a
 * later (or racing) load that found nothing.
 */
export function loadIdentity(): Promise<void> {
  // "Storage unreadable" is not an answer, so it must not be a life sentence:
  // a locked keychain or a half-initialized bridge can answer later in the same
  // session, and the renderer retries on the next consumer mount instead of
  // staying logged out until relaunch.
  if (!loadPromise || (!state.identity && state.loadError === 'unavailable')) {
    loadPromise = doLoadIdentity();
  }
  return loadPromise;
}

/** Can storage be read at all? A throwing localStorage is not "no identity". */
function storageReadable(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    localStorage.getItem('orbit_identity');
    return true;
  } catch {
    return false;
  }
}

async function doLoadIdentity(): Promise<void> {
  if (typeof window === 'undefined') { setState({ isLoaded: true }); return; }
  if (state.identity) { setState({ isLoaded: true }); return; } // already restored — never clobber
  if (!storageReadable()) {
    // getSecureItem() swallows the error and answers null, which would be
    // indistinguishable from a deliberate logout. Say so instead.
    logger.warn('[ORBIT Identity] Storage unreadable — not treating it as a logout.');
    setState({ isLoaded: true, loadError: 'unavailable' });
    return;
  }
  let stored: string | null = null;
  try {
    stored = getSecureItem('orbit_identity');
  } catch {
    // Storage unavailable — never block on it; show the landing/login.
    logger.warn('[ORBIT Identity] Secure storage unavailable — staying logged out.');
    setState({ isLoaded: true, loadError: 'unavailable' });
    return;
  }
  if (!stored) {
    logger.log('[ORBIT Identity] No identity stored — showing landing/login.');
    setState({ isLoaded: true, loadError: null });
    return;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<OrbitIdentity>;
    // An identity created from the onboarding flow must survive refreshes
    // while the user is still completing setup. Logout removes this key.
    if (parsed && parsed.orbitId && parsed.privateKeyHex) {
      setState({ identity: parsed as OrbitIdentity, isLoaded: true, loadError: null });
      logger.log('[ORBIT Identity] Loaded existing identity:', parsed.orbitId);
    } else {
      logger.log('[ORBIT Identity] Stored identity is anonymous/unclaimed — staying logged out.');
      setState({ isLoaded: true, loadError: null });
    }
  } catch {
    logger.warn('[ORBIT Identity] Invalid stored identity — staying logged out.');
    setState({ isLoaded: true, loadError: 'invalid' });
  }
}

/**
 * Publish a new identity value to every consumer + the legacy window events
 * other modules already listen for. `null` is an explicit logout.
 */
function publishIdentity(next: OrbitIdentity | null): void {
  setState({ identity: next, isLoaded: true, loadError: null });
  if (typeof window !== 'undefined') {
    if (next) {
      window.dispatchEvent(new CustomEvent('orbit-identity-changed', { detail: next }));
    } else {
      window.dispatchEvent(new CustomEvent('orbit-identity-cleared'));
    }
  }
}

export function createIdentity(): OrbitIdentity {
  // Clear old user metadata when generating a fresh identity
  if (typeof window !== 'undefined') {
    for (const key of USER_STORAGE_KEYS) {
      if (key !== 'orbit_identity') {
        try { localStorage.removeItem(key); } catch {}
        removeSecureItem(key)
      }
    }
  }
  const newIdentity = generateIdentity();
  setSecureItem('orbit_identity', JSON.stringify(newIdentity));
  publishIdentity(newIdentity);
  return newIdentity;
}

export function exportIdentity(): ExportedIdentityPayload | null {
  const identity = state.identity;
  if (!identity) return null;
  let displayName: string | undefined;
  let tags: string[] | undefined;
  if (typeof window !== 'undefined') {
    try {
      const d = localStorage.getItem('orbit_display_name');
      if (d && d.trim()) displayName = d.trim();
      const t = localStorage.getItem('orbit_tags');
      if (t) {
        const parsedTags = JSON.parse(t);
        if (Array.isArray(parsedTags)) tags = parsedTags;
      }
    } catch {}
  }
  return {
    ...identity,
    displayName,
    tags,
    version: 1,
    exportedAt: new Date().toISOString(),
  };
}

export function importIdentity(privateKeyHex: string, encryptionPrivHex?: string): boolean {
  try {
    const encKey = encryptionPrivHex && encryptionPrivHex.trim() ? encryptionPrivHex.trim() : privateKeyHex.trim();
    const newIdentity = restoreIdentity(privateKeyHex.trim(), encKey);
    setSecureItem('orbit_identity', JSON.stringify(newIdentity));
    publishIdentity(newIdentity);
    return true;
  } catch (e) {
    logger.error('[ORBIT Identity] Failed to import identity keys:', e);
    return false;
  }
}

export function loginWithExportedId(exportedData: string | object): { success: boolean; error?: string; identity?: OrbitIdentity } {
  try {
    let parsed: Record<string, unknown> | null = null;
    if (typeof exportedData === 'string') {
      const trimmed = exportedData.trim().replace(/^["']|["']$/g, '');
      // Check if string is raw JSON
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {}
      }

      // If not JSON, try base64 decode
      if (!parsed) {
        try {
          const decoded = decodeBase64Utf8(trimmed);
          if (decoded.startsWith('{') && decoded.endsWith('}')) {
            parsed = JSON.parse(decoded) as Record<string, unknown>;
          }
        } catch {}
      }

      // If still not parsed, check if it's a 64-char or 128-char hex private key
      if (!parsed) {
        const hexOnly = trimmed.replace(/\s+/g, '');
        if (/^[0-9a-fA-F]{64}$/.test(hexOnly)) {
          parsed = { privateKeyHex: hexOnly, encryptionPrivHex: hexOnly };
        } else if (/^[0-9a-fA-F]{128}$/.test(hexOnly)) {
          parsed = {
            privateKeyHex: hexOnly.substring(0, 64),
            encryptionPrivHex: hexOnly.substring(64, 128),
          };
        } else {
          return { success: false, error: 'Invalid key format. Please enter a valid 64-character secret key or exported JSON.' };
        }
      }
    } else {
      parsed = exportedData as Record<string, unknown>;
    }

    if (!parsed || typeof parsed !== 'object') {
      return { success: false, error: 'Invalid identity structure' };
    }

    const privKey = (parsed.privateKeyHex || parsed.privateKey || parsed.signingPrivateKey || parsed.secretKey) as string;
    if (!privKey || typeof privKey !== 'string') {
      return { success: false, error: 'Missing private key in exported identity' };
    }

    const encPrivKey = (parsed.encryptionPrivHex || parsed.encryptionPriv || privKey) as string;
    const restored = restoreIdentity(privKey.trim(), encPrivKey.trim());

    // Save restored identity
    setSecureItem('orbit_identity', JSON.stringify(restored));

    // Restore profile name and tags if present in the export payload
    if (typeof parsed.displayName === 'string' && parsed.displayName.trim()) {
      try { localStorage.setItem('orbit_display_name', parsed.displayName.trim()); } catch {}
    }
    if (Array.isArray(parsed.tags)) {
      try { localStorage.setItem('orbit_tags', JSON.stringify(parsed.tags)); } catch {}
    }

    publishIdentity(restored);

    return { success: true, identity: restored };
  } catch (err: unknown) {
    logger.error('[ORBIT Identity] loginWithExportedId error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to restore identity' };
  }
}

export function clearIdentity(): void {
  if (typeof window !== 'undefined') {
    wipeUserStorage();
    try { sessionStorage.clear(); } catch {}
    void clearObjects();
  }
  publishIdentity(null);
}

/** --- test seams --- */
export const _test = {
  reset: () => {
    state = EMPTY;
    listeners.clear();
    loadPromise = null;
  },
  /** Drop the memoized load so a test can exercise a second read. */
  resetLoadPromise: () => {
    loadPromise = null;
  },
  setIdentityForTest: (identity: OrbitIdentity | null) => {
    publishIdentity(identity);
  },
};
