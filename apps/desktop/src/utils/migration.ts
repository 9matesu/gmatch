"use client";

const STORAGE_PREFIX_OLD = "goonorbit";
const STORAGE_PREFIX_NEW = "goonmatch";
const INDEXEDDB_NAME_OLD = "goonorbit";
const INDEXEDDB_NAME_NEW = "goonmatch";
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

const configBackupKeys = [
  "settings",
  "friends",
  "blocked",
  "relationships",
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

export async function runMigrations(): Promise<void> {
  migrateBrandKeys();
  migrateLocalStorage();
  migrateConfigBackup();
  await migrateIndexedDB();
}

export function getStorageKey(key: string): string {
  return `${STORAGE_PREFIX_NEW}-${key}`;
}

export { STORAGE_PREFIX_NEW as STORAGE_PREFIX };