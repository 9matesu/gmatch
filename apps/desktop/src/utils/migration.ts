"use client";

const STORAGE_PREFIX_OLD = "goonorbit";
const STORAGE_PREFIX_NEW = "goonmatch";
const INDEXEDDB_NAME_OLD = "goonorbit";

const MIGRATION_FLAG = "goonmatch_migration_done";

const localStorageKeys = [
  "settings",
  "sfx-on",
  "friends",
  "blocked",
  "relationships",
  "decisions",
  "pfps",
  "playtime_ms",
  "coffee_acked_at",
  "coffee_never",
  "matches_total",
];



function migrateLocalStorage(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  let migrated = false;

  for (const key of localStorageKeys) {
    const oldKey = `${STORAGE_PREFIX_OLD}-${key}`;
    const newKey = `${STORAGE_PREFIX_NEW}-${key}`;
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue !== null) {
      localStorage.setItem(newKey, oldValue);
      localStorage.removeItem(oldKey);
      migrated = true;
    }
  }

  if (migrated) {
    localStorage.setItem(MIGRATION_FLAG, "1");
  }
}

function migrateConfigBackup(): void {
  if (typeof window === "undefined") return;

  const backupKey = "goonorbit-config";
  const newBackupKey = "goonmatch-config";
  const backup = localStorage.getItem(backupKey);
  if (backup !== null) {
    localStorage.setItem(newBackupKey, backup);
    localStorage.removeItem(backupKey);
  }
}

async function migrateIndexedDB(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;

  const databases = await window.indexedDB.databases?.();
  const hasOldDB = databases?.some((db) => db.name === INDEXEDDB_NAME_OLD);
  if (!hasOldDB) return;

  return new Promise((resolve) => {
    const deleteRequest = window.indexedDB.deleteDatabase(INDEXEDDB_NAME_OLD);
    deleteRequest.onsuccess = () => {
      resolve();
    };
    deleteRequest.onerror = () => {
      resolve();
    };
    deleteRequest.onblocked = () => {
      resolve();
    };
  });
}

// Brand rename (goonMatch/Grid -> gMatch): two localStorage DATA keys were
// product-named (idle save + seen-urls). The userData folder move (electron
// main) carries the leveldb verbatim, but the app now reads the new names —
// copy-once here so upgrading installs never lose the wallet/run progress.
const BRAND_KEY_RENAMES: Array<[string, string]> = [
  ["goongrid.save.v1", "gmatch.save.v1"],
  ["goongrid.seen.v1", "gmatch.seen.v1"],
]

function migrateBrandKeys(): void {
  if (typeof window === "undefined") return;
  for (const [oldKey, newKey] of BRAND_KEY_RENAMES) {
    // scoped variants too: `goongrid.save.v1:<orbitId>`
    const scopedOld = oldKey + ":"
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k === oldKey || k.startsWith(scopedOld))) keys.push(k)
      }
      for (const k of keys) {
        const target = newKey + k.slice(oldKey.length)
        if (localStorage.getItem(target) === null) {
          const v = localStorage.getItem(k)
          if (v !== null) {
            localStorage.setItem(target, v)
            localStorage.removeItem(k)
          }
        }
      }
    } catch {
      /* storage unavailable */
    }
  }
}

function migrateLegacyDomain(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const keysToCheck = ['gmatch.api.url', 'gmatch.central.url', 'gmatch.server.url'];
    for (const key of keysToCheck) {
      const val = localStorage.getItem(key);
      if (val && /fly\.dev/i.test(val)) {
        localStorage.removeItem(key);
      }
    }
    const dirRaw = localStorage.getItem('orbit_node_directory_v1');
    if (dirRaw && /fly\.dev/i.test(dirRaw)) {
      try {
        const parsed = JSON.parse(dirRaw);
        if (Array.isArray(parsed)) {
          let updated = false;
          for (const s of parsed) {
            if (s.endpoint_hint && /fly\.dev/i.test(s.endpoint_hint)) {
              s.endpoint_hint = 'https://gmatch-wcz1.onrender.com';
              updated = true;
            }
          }
          if (updated) localStorage.setItem('orbit_node_directory_v1', JSON.stringify(parsed));
        }
      } catch { /* parse error */ }
    }
  } catch {
    /* storage unavailable */
  }
}

export async function runMigrations(): Promise<void> {
  migrateBrandKeys();
  migrateLegacyDomain();
  migrateLocalStorage();
  migrateConfigBackup();
  await migrateIndexedDB();
}

export function getStorageKey(key: string): string {
  return `${STORAGE_PREFIX_NEW}-${key}`;
}

export { STORAGE_PREFIX_NEW as STORAGE_PREFIX };