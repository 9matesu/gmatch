import { useState, useEffect, useCallback } from 'react';
import { OrbitIdentity, generateIdentity, restoreIdentity } from '@orbit/crypto';
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

const USER_STORAGE_KEYS = [
  'orbit_identity',
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

export function useIdentity() {
  const [identity, setIdentity] = useState<OrbitIdentity | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('orbit_identity');
    } catch {
      // Storage unavailable — never block on it; show the landing/login.
      setIsLoaded(true);
      return;
    }

    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // An identity created from the onboarding flow must survive refreshes
        // while the user is still completing setup. Logout removes this key.
        if (parsed && parsed.orbitId && parsed.privateKeyHex) {
          setIdentity(parsed);
          logger.log('[ORBIT Identity] Loaded existing identity:', parsed.orbitId);
        } else {
          logger.log('[ORBIT Identity] Stored identity is anonymous/unclaimed — staying logged out.');
        }
      } catch {
        logger.warn('[ORBIT Identity] Invalid stored identity — staying logged out.');
      }
    } else {
      logger.log('[ORBIT Identity] No identity stored — showing landing/login.');
    }
    setIsLoaded(true);
  }, []);

  const createIdentity = useCallback(() => {
    // Clear old user metadata when generating a fresh identity
    if (typeof window !== 'undefined') {
      for (const key of USER_STORAGE_KEYS) {
        if (key !== 'orbit_identity') {
          try { localStorage.removeItem(key); } catch {}
        }
      }
    }
    const newIdentity = generateIdentity();
    localStorage.setItem('orbit_identity', JSON.stringify(newIdentity));
    setIdentity(newIdentity);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orbit-identity-changed', { detail: newIdentity }));
    }
    return newIdentity;
  }, []);

  const exportIdentity = useCallback((): ExportedIdentityPayload | null => {
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
  }, [identity]);

  const importIdentity = useCallback((privateKeyHex: string, encryptionPrivHex?: string) => {
    try {
      const encKey = encryptionPrivHex && encryptionPrivHex.trim() ? encryptionPrivHex.trim() : privateKeyHex.trim();
      const newIdentity = restoreIdentity(privateKeyHex.trim(), encKey);
      localStorage.setItem('orbit_identity', JSON.stringify(newIdentity));
      setIdentity(newIdentity);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbit-identity-changed', { detail: newIdentity }));
      }
      return true;
    } catch (e) {
      logger.error('[ORBIT Identity] Failed to import identity keys:', e);
      return false;
    }
  }, []);

  const loginWithExportedId = useCallback((exportedData: string | object): { success: boolean; error?: string; identity?: OrbitIdentity } => {
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
      localStorage.setItem('orbit_identity', JSON.stringify(restored));

      // Restore profile name and tags if present in the export payload
      if (typeof parsed.displayName === 'string' && parsed.displayName.trim()) {
        try { localStorage.setItem('orbit_display_name', parsed.displayName.trim()); } catch {}
      }
      if (Array.isArray(parsed.tags)) {
        try { localStorage.setItem('orbit_tags', JSON.stringify(parsed.tags)); } catch {}
      }

      setIdentity(restored);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbit-identity-changed', { detail: restored }));
      }

      return { success: true, identity: restored };
    } catch (err: unknown) {
      logger.error('[ORBIT Identity] loginWithExportedId error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Failed to restore identity' };
    }
  }, []);

  const clearIdentity = useCallback(() => {
    if (typeof window !== 'undefined') {
      for (const key of USER_STORAGE_KEYS) {
        try { localStorage.removeItem(key); } catch {}
      }
      try { sessionStorage.clear(); } catch {}
      void clearObjects();
    }
    setIdentity(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orbit-identity-cleared'));
    }
  }, []);

  return {
    identity,
    isLoaded,
    createIdentity,
    exportIdentity,
    importIdentity,
    loginWithExportedId,
    clearIdentity,
  };
}
