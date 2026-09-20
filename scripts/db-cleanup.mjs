#!/usr/bin/env node
// ponytail: one-shot migration, run via fly ssh console or locally against prod db copy
// Usage: node scripts/db-cleanup.mjs <path-to-sqlite>
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.argv[2];
if (!dbPath) { console.error('Usage: node db-cleanup.mjs <sqlite-path>'); process.exit(1); }

const db = new DatabaseSync(dbPath);

// 1. Delete cards where creator has no display_name (Unknown User cards)
//    Cascade: CardHistory -> CardOwnership -> Cards -> Objects (only if not referenced elsewhere)
console.log('--- Phase 1: Purge Unknown User cards ---');

const unknownCards = db.prepare(`
  SELECT c.id, c.media_object_id
  FROM Cards c
  LEFT JOIN Users u ON u.id = c.creator_id
  WHERE u.display_name IS NULL OR TRIM(u.display_name) = ''
`).all();

console.log(`Found ${unknownCards.length} cards from users with no display_name`);

let deletedCards = 0;
let deletedObjects = 0;

for (const card of unknownCards) {
  db.prepare('DELETE FROM CardHistory WHERE card_id = ?').run(card.id);
  db.prepare('DELETE FROM CardOwnership WHERE card_id = ?').run(card.id);
  const res = db.prepare('DELETE FROM Cards WHERE id = ?').run(card.id);
  deletedCards += res.changes;

  // Delete backing object only if no other card references it
  const refs = db.prepare('SELECT count(*) as c FROM Cards WHERE media_object_id = ?').get(card.media_object_id);
  if (refs.c === 0) {
    const objRes = db.prepare('DELETE FROM Objects WHERE id = ?').run(card.media_object_id);
    deletedObjects += objRes.changes;
  }
}

console.log(`Deleted: ${deletedCards} cards, ${deletedObjects} orphaned objects`);

// 2. Backfill PFPs: for users whose pfp_url points to /api/objects/<id>,
//    copy the Objects.content_url (which is already a base64 data URL) into Users.pfp_url
console.log('\n--- Phase 2: Backfill PFP from Objects to Users.pfp_url ---');

const pfpUsers = db.prepare(`
  SELECT u.id, u.pfp_url, o.content_url
  FROM Users u
  INNER JOIN Objects o ON u.pfp_url LIKE '%/api/objects/%'
    AND o.id = REPLACE(u.pfp_url, '/api/objects/', '')
  WHERE o.content_url LIKE 'data:image/%'
`).all();

console.log(`Found ${pfpUsers.length} users with /api/objects/ PFP refs that have data URLs`);

let updatedPfps = 0;
const updateStmt = db.prepare('UPDATE Users SET pfp_url = ? WHERE id = ?');

for (const row of pfpUsers) {
  const res = updateStmt.run(row.content_url, row.id);
  updatedPfps += res.changes;
}

console.log(`Updated: ${updatedPfps} user PFPs to inline data URLs`);

// 3. Verify
console.log('\n--- Verification ---');
const remainingUnknown = db.prepare(`
  SELECT count(*) as c FROM Cards c
  LEFT JOIN Users u ON u.id = c.creator_id
  WHERE u.display_name IS NULL OR TRIM(u.display_name) = ''
`).get();
console.log(`Remaining Unknown User cards: ${remainingUnknown.c}`);

const remainingObjRefs = db.prepare(`
  SELECT count(*) as c FROM Users WHERE pfp_url LIKE '/api/objects/%'
`).get();
console.log(`Users still pointing to /api/objects/ for PFP: ${remainingObjRefs.c}`);

console.log('\nDone.');
