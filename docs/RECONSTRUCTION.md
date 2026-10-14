# 1.5.5 reconstruction record

> **Status:** Authoritative for the `recover/1.5.5-base` line.
> Raw machine output lives in `docs/reconstruction/` (`diffstat.txt`,
> `commits.txt`, `name-status.txt`). This file holds the decisions, not the bytes.

## 1. Protection record (doomed branch untouched)

| Item | Evidence |
| :--- | :--- |
| Doomed branch | `perf/feed-latency-and-providers` @ `c147131`, **108 commits** ahead of baseline, **223 dirty/untracked paths**, 1 stash (`security/wave2-ip-masks`) |
| Baseline tag | `refs/tags/v1.5.3` → tag object `391ecc3` → commit `e7cb859` (2026-09-29, release commit). Both ancestors of the doomed tip |
| Recovery line | `recover/1.5.5-base` created at `e7cb859`, checked out as worktree `I:\goongrid-recover`. No reset, no clean, no force-push, no `git add` in the doomed tree |
| Diff scope | `v1.5.3^{commit}..c147131` = **363 files, +44,221/−4,846**. Working-tree (uncommitted) changes explicitly **out of scope** — noted where they matter (§6) |

## 2. Triage key

- **useful** — measured improvement, keep the behavior.
- **broken** — retained harm, fix on port.
- **redundant** — behavior-preserving move/duplicate, port the fix, not the layout.
- **unnecessary** — speculative/tunable without proof, or no-op infra; leave out.
- **uncertain** — needs investigation before any port.
- Decisions: **reproduce** (port), **discard**, **redesign** (port per-concern, not wholesale), **investigate**.

## 3. Gossip / moderation / retention — reproduce as a block

| Change (commits) | 1.5.3 | Branch | Verdict → decision |
| :--- | :--- | :--- | :--- |
| Permanent retention (`e0ed1ed`, `69b847f`, `9c9475a`) | 3d/14d/48h prunes; envelope sweep + 20k eviction | prune ephemera only (stories/sessions/rate-limits); identity memory only | useful → **reproduce** `9c9475a` final; discard intermediate 7d/30d/20k numbers |
| Derived counts (`48f77c0`, `3e74100`) | cached `like_count±1`, swipe tally shipped as `likes_count`, `PostLikes` missing from snapshot + wipe | `COUNT(*)` folds, inbox renamed `decision_likes_count`, snapshot+wipe fixed | useful → **reproduce** |
| Reaction LWW (`a1301a1`, mig 058) | no reaction envelope | versioned facts, strict `>`, content-addressed unlike≠like | useful → **reproduce** |
| Apply-on-receipt + bounded forward (`6aef211`, mig 059) | stored-only, inert on all deploys | apply on receipt, `pending` vs `rejected`, post-sweep + 60s timer, Fanout≤8, once-only, SSRF-guarded | useful → **reproduce** |
| Withdrawal tombstone (`ad7168b`, mig 060) | local delete, re-pull resurrects | id-scoped (hash rejected), owner-checked, tombstone-first, terminal | useful → **reproduce** |
| Takedown + server content hash (`6a0fd8c`, `f63045e`, mig 061/062) | no takedown, trusted client hash | `(hash,node_id)` tombstone, server-hashed bytes incl. proxy, born-hidden, fail-closed | useful → **reproduce** (`/register` client-claim = accepted limit) |
| Signed node records (`084e242`) | ephemeral central directory | derivable `node_id=sha256(pubkey\|name)`, content-addressed envelope id | useful → **reproduce** |
| SSRF guard (`1b70905`) | unchecked `endpoint_hint` dial | deny-list + loopback/metadata deny, DNS-rebinding unsolved (stated) | useful → **reproduce** |
| Upstream config + auto-bootstrap/detach (`c551baf`, `f063991`) | frozen env, single cursor | `SystemMeta` upstreams, per-upstream cursors, empty-node auto-seed, stall-detach | useful → **reproduce** `f063991` final; discard deleted UI |
| Idle cadence + parked exemption (`e58598a`) | 60s×200×every node forever | self-reschedule on APPLIED, ~5min idle, parked never evicted | useful → **reproduce** cadence only |
| Client reaction relay (`a98255f`) | reactions discarded, cursor skipped them | verified reactions relayed to own ingest; pre-envelope likes unrecoverable (stated) | useful → **reproduce** |
| Idempotent register (`97e78c1`) | bare INSERT, backfill 500s | `ON CONFLICT DO UPDATE … WHERE owner`, bad torrent claims dropped | useful → **reproduce** |

## 4. Torrent / media / swarm — reproduce, dedupe on port

| Change (commits) | 1.5.3 | Branch | Verdict → decision |
| :--- | :--- | :--- | :--- |
| Real infohash core (`cf29282`, `packages/shared/src/torrent.ts`) | `sha256(bytes)[:40]` fake magnets | bencode + `sha1(infoDict)`, wss-only rule, interop-pinned vs `create-torrent` | useful → **reproduce** |
| Upload mints real address (`58e9f7c`, `1d599a6`) | fake magnet, fail-closed register | real `infohash/piece_*`, server content hash, best-effort register, payload written | useful → **reproduce** (`registerTorrent.ts` dead twin — pick one) |
| Blind wss tracker (`e8122cc`) | none | in-mem infohash→peers, TTL 30m, 50/5000 caps, no listing | useful → **reproduce** |
| API payload + chunk stores (`0ea3efd`, `7b65750`) | whole-buffer reads | range reads, temp-then-rename, WebTorrent store contract | useful → **reproduce** |
| Main seed policy + client (`08bd2c5`, `567ee07`) | none | `resolveTracker`/`planSeeds` (no public trackers, tombstones), lazy webtorrent, no-DHT | useful → **reproduce** |
| Main store twin (`54488c6`) | none | CJS re-implementation, parity-tested (12 inputs) | useful-but-redundant → **reproduce + redesign** to single source |
| Backfill (`ca652d9`) | legacy library fake forever | batched real-address repair | useful → **reproduce**; **investigate** `torrent_infohash` vs `infohash` field mismatch |
| Moderation bridge (`f63045e`, mig 062) | takedown bypassable via torrent path | separate `TorrentInfo`, dual lookup, fail-closed | useful → **reproduce** |
| `magnet.ts` at tip | `&tr=` public trackers appended | same (fix only in working tree) | **broken** → port the working-tree strip, not the tip |
| SWARM RAM + transfer guards (`3caa5fd`, `8443d00`) | 256MB mirror, N×full replies, attacker-shaped assembly | 32MB LRU + IDB fallback, unsolicited-drop, first-total-wins | useful → **reproduce** (SWARM stays legacy coexistence) |
| Media cache/mime (`30e137d`, `eef79e7`, `37e6bcc`) | unbounded/timeout-less, SVG keepsakes | timeouts, derived-key restart-proof cache, keepsakes = files | useful → **reproduce** selectively |

Duplicate responsibilities to collapse on port: payload path/geometry (API vs main twin),
chunk-store contract twins, `validateInfohash` twins, `mediaForge`-register vs
`registerTorrent`, `TorrentInfo` vs legacy `content_url` (intentional dual, bridged).

## 5. Presence / DM / LAN / directory — reproduce except rendezvous

| Change (commits) | 1.5.3 | Branch | Verdict → decision |
| :--- | :--- | :--- | :--- |
| DM outbox + IDB threads (`e406c56`) | missing-key/throw = permanent loss, LS threads | write-ahead outbox, re-seal per attempt, receipts queued, honest `unconfirmed` | useful → **reproduce** (still courier-carried) |
| DM edit/delete ops (`aecc837`) | courier-mode no-op at peer | sealed versioned ops, terminal delete, tombstones | useful → **reproduce** |
| Room fan-out queue (`ad1ad85`) | keyless members silently skipped | per-member owed envelope, 50/room 7d TTL, rotation discards honestly, `N undelivered` | useful → **reproduce** |
| Sealed post delivery (`a7e3296`, `74f3762`, `c7517c4`, `094429f`) | off-mesh followers unreachable | `seal1to1` post copies, IDB queue, friend+follower fan-out, ingest with author verify | useful → **reproduce**; **investigate** heterogeneous-base reachability |
| Post-envelope pull multi-node (`acd0a1e`, `200e945`) | foreign posts discarded, own-only gallery | signature-verified pull, per-id-per-node cursors, first-wins dedupe, `ok:false`≠empty | useful → **reproduce** (courier excluded by design) |
| Presence rendezvous (`d6a48ab`) | per-base beacons (invisible across processes) | hardcoded single-host rendezvous | works-but-centralizing → **redesign**: multi-home rendezvous, never one host |
| Presence honesty (`5178a5e`, `64ccb9e`) | flickering/max() counts, host claims as fact | measured-or-`—`, stale-flagged, per-row probes, unverified labeled | useful → **reproduce** |
| `useP2P` naming/intervals (`729c9f7`, `20feb0c`) | `isWsConnected` lie, inline ternaries | `isLegacyWsConnected` + pure `pollIntervalsFor`, dead props removed | useful → **reproduce**; unify `courierRelayFor` with `nodeCaps` = **investigate** |
| Caps-based mail-mode (`fb63025`) | two-host hostname list | `/api/health` mode probe | useful → **reproduce** |
| LAN discovery + adopt (`982c885`, `e8b4c3f`) | none | address-free beacons, identity-only adopt, cap 8, `peer_source` typed | useful → **reproduce** (discovery courier-free; signaling still rides courier) |
| Directory provenance + floor (`8f3a11e`, `f2ab544`, `cd671eb`, `f4c8206`) | last_seen-wins, central-gated, blank-on-error | `gossip<directory<bootstrap<manual`, fill-never-blank, floor-first, Courier/Legacy-frozen labels client-side | useful → **reproduce** |
| Feed states + provenance (`200283f`, `111f03f`, `f063991`) | loading/error/empty identical; 60s prune-as-delete | `feedStatus`, pure `resolveFeedState`, append-only merge, per-row provenance | useful → **reproduce** |

Unchanged in range (frozen semantics, no verdict needed): server `mail.ts`,
`signal.ts`, `turn.ts`, `mail-store.ts`, `site-services.ts`, `ice-hygiene.ts`,
`courierSignaling.ts`, `lanSignaling.ts`, `mail-client.ts`, `groupOutbox.ts`, `flySignal.ts`.

## 6. Booru / game / UI / infra — port fixes, not layout or churn

- **Reproduce:** strict AND relevance (`7c9eb21`); feed-latency core — warm-at-≤3, 4-slot pool, timeouts (`552c87f`); round-cost split — pre-gated tagless lists, lane-bound walk, 3s scraper reserve (`c3fbaea`); scheduler unification (`3d83064`); attempt runner (`7bdb7b8`); parity table (`45d4aae`); small-pool paging (`c147131`); fail-closed rating gate (`bb2342a`); click-only economy + achievement migration, `SAVE_VERSION` stays 3 (`460e6b8`); feed honesty/merge/provenance; terminology renames; smoke gate (`ef03314`); courier keepalive; `api-network` hardening.
- **Discard layout, keep fixes:** `booru.ts` 8-module split (`ebb81a1` — port the two coupling fixes only); `App.tsx +612` god-diff (cherry-pick per-concern).
- **Investigate separately:** `red` source policy (carries hard-block terms, survives only via per-post block); speculative tunables (`HEDGE_AFTER_MS`, `MIRROR_LANES`, `WARM_MIN_GAP`, `FALLBACK_RESERVE`, `MAX_FEED_POSTS` — measured once, keep as tested constants).
- **Leave dead:** `OfflineModal`, passive/auto income, `offline_slut`, bare-cover babesource shape, `firstWithPosts`, dual schedulers, `isWsConnected`.
- **No-op in range:** `fly.toml`/`Dockerfile`/`render.yaml`/`snapshot-fly`/`site/release` — nothing to port.

## 7. Explicitly NOT in the committed range (working tree only)

`torrent:fetch` IPC, `torrent-fetch-core.cjs`, `torrentFetch.ts`, `mediaResolve.ts`,
`objectFetch.ts`, payload LRU/2GiB budget, `local→node→torrent→swarm→placeholder`
order, `SWARM_HAVE`, multi-tracker announce. At `c147131` the mesh is
**addressable + seedable, not fetchable**. These need working-tree investigation
before any verdict — they are not part of this inventory.

## 8. 1.5.5 scope decision

1.5.5 = clean recovery release: verified 1.5.3 code + this inventory + framework
ADRs (`docs/DECISIONS.md`) + target-architecture docs + version bump. The
reproduce/redesign rows above are the queued reconstruction backlog, not claimed
as done. No row is marked complete until its port lands with tests on this line.
