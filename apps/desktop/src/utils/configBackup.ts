"use client";

import { getAllStash } from "./stash";
import type { StashEntry } from "./stash";
import type { AppSettings } from "../hooks/useSettings";
import type { ExportedIdentityPayload } from "../hooks/useIdentity";

export const CONFIG_SCHEMA = "goonmatch-config";
export const CONFIG_VERSION = 2;

export interface ConfigStashEntry extends Omit<StashEntry, "data"> {
  dataBase64: string;
}

export interface ConfigBundle {
  schema: typeof CONFIG_SCHEMA;
  version: number;
  exportedAt: string;
  identity: ExportedIdentityPayload;
  settings?: Partial<AppSettings>;
  cards?: { p2pGallery: unknown[]; unlockedStories: string[] };
  stash?: ConfigStashEntry[];
  friends?: { friends: string[]; blocked: string[]; relationships: unknown[] };
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Read the current AppSettings blob straight from localStorage. */
export function readRawSettings(): Partial<AppSettings> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem("goonmatch-settings");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AppSettings;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Collect every client-side slice of a user's config into one bundle. */
export async function collectConfigBundle(identityPayload: ExportedIdentityPayload): Promise<ConfigBundle> {
  const settings = readRawSettings();
  const cards = {
    p2pGallery: readLocal<unknown[]>("orbit_p2p_gallery", []),
    unlockedStories: readLocal<string[]>("orbit_unlocked_stories", []),
  };
  const stash = await getAllStash().catch(() => [] as StashEntry[]);
  const stashEntries: ConfigStashEntry[] = stash.map((entry) => ({
    id: entry.id,
    name: entry.name,
    dataBase64: bytesToBase64(entry.data),
    dataUrl: entry.dataUrl,
    mimeType: entry.mimeType,
    size: entry.size,
    addedAt: entry.addedAt,
  }));
  const friends = {
    friends: readLocal<string[]>("goonmatch-friends", []),
    blocked: readLocal<string[]>("goonmatch-blocked", []),
    relationships: readLocal<unknown[]>("goonmatch-relationships", []),
  };

  return {
    schema: CONFIG_SCHEMA,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    identity: identityPayload,
    settings,
    cards,
    stash: stashEntries,
    friends,
  };
}

/** Restore a config bundle into localStorage. Does NOT touch identity keys. */
export function applyConfigBundle(bundle: Partial<ConfigBundle>): { restored: string[] } {
  const restored: string[] = [];

  if (bundle.settings && typeof bundle.settings === "object") {
    try {
      const existing = readRawSettings() || {};
      localStorage.setItem("goonmatch-settings", JSON.stringify({ ...existing, ...bundle.settings }));
      restored.push("settings");
    } catch {}
  }

  if (bundle.cards) {
    if (Array.isArray(bundle.cards.p2pGallery)) {
      try { localStorage.setItem("orbit_p2p_gallery", JSON.stringify(bundle.cards.p2pGallery)); restored.push("p2p_gallery"); } catch {}
    }
    if (Array.isArray(bundle.cards.unlockedStories)) {
      try { localStorage.setItem("orbit_unlocked_stories", JSON.stringify(bundle.cards.unlockedStories)); restored.push("unlocked_stories"); } catch {}
    }
  }

  if (bundle.friends) {
    if (Array.isArray(bundle.friends.friends)) {
      try { localStorage.setItem("goonmatch-friends", JSON.stringify(bundle.friends.friends)); restored.push("friends"); } catch {}
    }
    if (Array.isArray(bundle.friends.blocked)) {
      try { localStorage.setItem("goonmatch-blocked", JSON.stringify(bundle.friends.blocked)); restored.push("blocked"); } catch {}
    }
    if (Array.isArray(bundle.friends.relationships)) {
      try { localStorage.setItem("goonmatch-relationships", JSON.stringify(bundle.friends.relationships)); restored.push("relationships"); } catch {}
    }
  }

  return { restored };
}

/**
 * Restore the stash slice of a config bundle into IndexedDB. Each entry that
 * already exists (same id) is skipped to avoid clobbering newer stash items.
 */
export async function applyStashFromBundle(entries: ConfigStashEntry[]): Promise<number> {
  if (!entries || entries.length === 0) return 0;
  const { addStashEntry } = await import("./stash");
  let added = 0;
  for (const entry of entries) {
    try {
      const addedOk = await addStashEntry({
        id: entry.id,
        name: entry.name,
        data: base64ToBytes(entry.dataBase64),
        dataUrl: entry.dataUrl,
        mimeType: entry.mimeType,
        size: entry.size,
        addedAt: entry.addedAt,
      });
      if (addedOk) added++;
    } catch {}
  }
  return added;
}

/** Serialise a bundle to a JSON string (prettified for human inspection). */
export function bundleToString(bundle: ConfigBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Parse a config file/string. Returns the bundle or null if it is invalid. */
export function parseConfigBundle(input: string | object): ConfigBundle | null {
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schema !== CONFIG_SCHEMA) return null;
    if (!parsed.identity || !parsed.identity.privateKeyHex) return null;
    return parsed as ConfigBundle;
  } catch {
    return null;
  }
}

export function configDownloadFilename(bundle: ConfigBundle): string {
  const id = bundle.identity.orbitId || "anonymous";
  return `goonmatch-${id.slice(0, 8)}.goon-config.json`;
}
