import { useEffect, useSyncExternalStore } from 'react';
import {
  subscribeIdentity,
  identitySnapshot,
  loadIdentity,
  createIdentity,
  exportIdentity,
  importIdentity,
  loginWithExportedId,
  clearIdentity,
  wipeUserStorage,
  getCurrentIdentity,
  USER_STORAGE_KEYS,
  type ExportedIdentityPayload,
  type IdentityStoreState,
} from '../services/identityStore';

// The one authoritative identity lives in `services/identityStore` (plan A1);
// this hook is only a React binding, so every consumer (App, chat, keepsake,
// notifications, settings, idle save slot) reads and observes the SAME value.
export type { ExportedIdentityPayload };
export { wipeUserStorage, getCurrentIdentity, USER_STORAGE_KEYS };

export function useIdentity(): IdentityStoreState & {
  createIdentity: typeof createIdentity;
  exportIdentity: typeof exportIdentity;
  importIdentity: typeof importIdentity;
  loginWithExportedId: typeof loginWithExportedId;
  clearIdentity: typeof clearIdentity;
} {
  const state = useSyncExternalStore(subscribeIdentity, identitySnapshot, identitySnapshot);
  // Every consumer may mount first; the store itself guarantees the load runs
  // once and that a resolved identity is never overwritten by a racing load.
  useEffect(() => {
    void loadIdentity();
  }, []);
  return {
    identity: state.identity,
    isLoaded: state.isLoaded,
    loadError: state.loadError,
    createIdentity,
    exportIdentity,
    importIdentity,
    loginWithExportedId,
    clearIdentity,
  };
}
