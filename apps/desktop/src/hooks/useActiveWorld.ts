"use client";

// The world this renderer is in, read ONCE at boot and pushed into
// `serverWorlds` so non-React stores (feed snapshot, operation log, roster,
// chat seen) can namespace their keys. Identity is GLOBAL — one player, one
// display name, one idle save across worlds; only cached SOCIAL data is per
// world (see utils/serverWorlds.ts).
import { useEffect, useState } from "react";
import { getApiBaseUrl, isLoopbackApiUrl, subscribeApiBase } from "../utils/api";
import { DEFAULT_WORLD_ID, setActiveWorldId, worldIdForAddress } from "../utils/serverWorlds";

/** The world an API base names: this install's own node (loopback / dev proxy)
 *  is the default world; any other address is the world keyed by it — the same
 *  id `switchClientWorld` commits to the node. */
function worldIdForBase(base: string): string {
  return !base || isLoopbackApiUrl(base) ? DEFAULT_WORLD_ID : worldIdForAddress(base);
}

export function useActiveWorld(): string {
  // Seed SYNCHRONOUSLY during the first render: a store read in a child effect
  // (the feed hydrate, the roster load) then already sees the right namespace,
  // before server:state — an async IPC — has answered.
  const [worldId, setWorldId] = useState<string>(() => {
    const seeded = worldIdForBase(getApiBaseUrl());
    setActiveWorldId(seeded);
    return seeded;
  });

  useEffect(() => {
    let cancelled = false;
    const apply = (id: string) => {
      setActiveWorldId(id);
      setWorldId(id);
    };
    // Confirm from the authoritative source once boot resolves.
    void Promise.resolve(window.gmatch?.serverState?.())
      .then((st) => { if (!cancelled && st) apply(st.worldId || DEFAULT_WORLD_ID); })
      .catch(() => { /* no bridge / IPC fault: the seeded id stands */ });
    // A committed client switch re-derives immediately (its reload also covers it).
    const unsub = subscribeApiBase((base) => apply(worldIdForBase(base)));
    return () => { cancelled = true; unsub(); };
  }, []);

  return worldId;
}
