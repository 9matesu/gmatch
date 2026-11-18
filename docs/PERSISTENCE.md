# Persistence: who owns what

Five storage mechanisms, one rule: **a cache is never the authority, and a miss
costs exactly one re-read.** This file is the map; the code is the source. When
they disagree, the code wins and this file is stale.

| Data | Authority | Other copies | Invalidated / replaced by |
|---|---|---|---|
| Identity, keys, secret key | Secure KV, DPAPI-scoped (`services/secure-storage.ts`, `services/identityStore.ts`) | none in plaintext | account wipe; identity switch |
| Posts, comments, likes, follows, profiles | The node's SQLite (`userData/orbit.sqlite`) | durable local outbox (`gmatch_post_outbox_v1`), signed operation log | tombstone (`post.delete`), author's next signed statement |
| Media bytes | Encrypted vault (`media-vault/`) + IndexedDB (`orbit-gallery`) | the node's blob store (when it holds them) | purge on deletion (RAM + disk + vault) |
| Preferences (theme, feed, panels) | localStorage `goonmatch-settings` | React state | settings save |
| Idle economy (pts, tags, caps, gallery) | localStorage `gmatch.save.v1` | React state | prestige / reset (never synced) |
| Read stamps (DM/room) | localStorage, identity-scoped (`utils/scopedSeen.ts`) | notification centre derives from the store | opening the conversation |
| Presence / online roster | in-memory roster (signed beacons, 60 s TTL) | localStorage peer hints (`utils/peerNodes.ts`) | TTL expiry |
| Node directory | the node's directory + `orbit_node_directory_v1` | localStorage hints | heartbeat (24 h) |
| Release feed | `release.json` on the Pages site or the node | updater's downloaded file | new release |

## Rules

- **Two economies, never bridged:** idle `pts` live only in the save; server `g$`
  is the `EconomyService` ledger.
- **A cache miss is not data loss.** Every cache in the app (memory LRU, imgcache,
  IndexedDB, outbox mirror) can be dropped and rebuilt from the authority.
- **Write locally first, then sync.** A post commits to the outbox before any
  network call; a failed request never loses it.
- **Deletion is a tombstone.** Nothing hard-deletes; a replay cannot resurrect.
- **Nothing leaves the machine unsealed.** Media chunks, DMs and presence beacons
  are end-to-end encrypted; the node relays ciphertext.

## Where the caches are bounded

| Cache | Bound |
|---|---|
| Swarm RAM (`utils/p2pSwarm.ts`) | 64 objects / 96 MB, LRU |
| Media URL cache (`utils/mediaData.ts`) | 512 entries, URL revoked on eviction |
| Feed index (main process) | RAM only, 10 min / 40 queries |
| Encrypted picture LRU (main) | 500 MB on disk |
| Notifications (server) | 50 rows, pruned after 48 h |
| Replication receipts | 256, revalidated on boot |
| DM history | 2,000 per thread |