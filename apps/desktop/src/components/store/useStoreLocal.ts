"use client";

/**
 * Per-identity store state that lives only on this device: the wishlist and
 * the recently-viewed keys. Both are scoped through the shared
 * `utils/scopedSeen` helpers, so two accounts on one install never inherit
 * each other's lists (the same rule the chat read stamps use).
 *
 * The keys are `StoreProduct.key` strings; a key whose product is gone from
 * the current catalogue simply resolves to nothing (`productsForKeys`).
 */
import { useCallback, useEffect, useState } from 'react';
import { readScopedJson, writeScopedJson } from '../../utils/scopedSeen';
import {
  RECENT_KEY, WISHLIST_KEY, pushRecentKey, sanitizeKeys, toggleKey,
} from './storeCatalog';

export function useStoreLocal(scope: string | null | undefined) {
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setWishlist(sanitizeKeys(readScopedJson<unknown>(WISHLIST_KEY, scope, [])));
    setRecent(sanitizeKeys(readScopedJson<unknown>(RECENT_KEY, scope, [])));
  }, [scope]);

  const toggleWishlist = useCallback((key: string) => {
    setWishlist((prev) => {
      const next = toggleKey(prev, key);
      writeScopedJson(WISHLIST_KEY, scope, next);
      return next;
    });
  }, [scope]);

  const pushRecent = useCallback((key: string) => {
    setRecent((prev) => {
      const next = pushRecentKey(prev, key);
      writeScopedJson(RECENT_KEY, scope, next);
      return next;
    });
  }, [scope]);

  return { wishlist, recent, toggleWishlist, pushRecent };
}
