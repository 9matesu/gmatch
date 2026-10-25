# Local-first / decentralized implementation backlog

This is the execution plan for moving gMatch from its current hybrid
architecture toward a genuinely local-first, peer-replicated social app. It is
an implementation backlog, not a claim that the target architecture exists.
Keep tasks small and independently reviewable. For each code task: add a
regression test first, update the behavior-owning document in the same change,
run the narrow checks, then commit only the files in that slice.

## Current state and constraints

- **No hosted world (2026-10-24).** The Fly full node and the Render courier
  were retired. Nothing resolves to them any more: packaged installs start
  their OWN node (host mode is the default), and the only shared piece is a
  blind Cloudflare rendezvous at `gmatch.pages.dev` — a signed public-node
  directory plus a sealed-mail relay in D1, with no content tables, accounts,
  presence or TURN. The courier role is still "the node each client is
  connected to": blind, stateless, only moving ciphertext. The end state is
  **direct peer-to-peer** — no third-party host storing posts, media, comments,
  likes, profiles or presence (SPEC §12b). Every route's fate is written down
  in `docs/API-INVENTORY.md`.
- The desktop app still uses API nodes for feed reads and writes, comments,
  likes, profile/directory data, notifications, Lobby chat, and other social
  state. Public gossip replicates signed post metadata between hosts, but that
  is not an independent-peer social data plane.
- The media swarm uses `HAVE/WANT/CHUNK` over transports wired by
  `apps/desktop/src/hooks/useP2P.ts`. Chunk frames and objects are bounded;
  expected SHA-256 hashes are checked, and a received object resolves only
  after persistence. Advertisements and a successful send are not evidence
  that a second peer durably holds the object.
- `gmatch_post_outbox_v1` and pending-transfer hints use `localStorage` and are
  best-effort, not transactional. Persisted media uses the Electron vault or
  IndexedDB fallback. Neither currently forms a durable, replayable operation
  log for all social mutations.
- The gossip API validates envelope shape/signature and now binds `author_id`
  to SHA-256 of the included Ed25519 public key on both write and apply paths.
  This authenticates authorship; it does not define deletion, edits, ACLs,
  conflict resolution, or media availability.
- Public posts/media METADATA is not confidential: captions, manifests and
  operations travel signed but public. The media BYTES of a swarm transfer are
  sealed end to end since swarm-v1 (2026-10-22), including over the relay.
  Keep the existing DM envelope unless a concrete cryptographic defect is
  shown; do not silently change its wire format.
- The central deployment is configured as a blind courier and returns 404 for
  stateful routes. Do not make it a content host or open remote CORS as a
  workaround. Reproduce API routing/configuration errors against a recorded
  runtime before changing them.
- Do not remove, rewrite, or migrate user data destructively. Add versioned,
  idempotent migrations and preserve legacy records until tested recovery is
  demonstrated. The single age gate and client-side prohibited-tag blocklist
  remain mandatory.

## What changed on 2026-10-22, later (P2P hardening round)

- **Swarm media is sealed end to end (swarm-v1)**: the fetcher offers a fresh
  ephemeral X25519 key per transfer, the seeder ships a DEK sealed to it, and
  every chunk is XChaCha20-Poly1305 with AAD binding object/transfer/index/
  fetcher. Legacy plaintext is default-deny. The relay now carries ciphertext
  it cannot read or alter (docs/ARCHITECTURE-P2P.md §4).
- **Transport selection is explicit** (`utils/transportState.ts`): bounded
  direct dials (12 s default), relay kept alive meanwhile, validated promotion
  only on DataChannel open, exponential backoff + jitter for retries, and the
  roster label reports the real path (`P2P direto` / `relay via nó (NAT)` /
  `sem rota`). The relay guarantees the mesh works where a direct hole cannot
  be punched; it does not solve symmetric NAT for the direct path.
- **Profile fields are versioned operations** (`profile.update`): display
  name/bio resolve deterministically per actor by highest sequence with
  carry-forward of unnamed fields; an empty string is an explicit clear;
  `saveUserProfile` publishes the op and inbound ops feed the name directory.
- **Deletion is a tombstone plus a purge**: an accepted `post.delete` also
  purges the replica's bytes (RAM + IndexedDB + vault) for that content hash.
  Honest limits are documented: a tombstone is accepted only after the author's
  chain is known, and an offline replica withdraws on the next wave.
- **Evidence, executed vs not**: `apps/desktop/scripts/p2p-two-process.mjs`
  runs the production engine in two real processes through an untrusted relay
  — clean transfer byte-identical, one-byte tamper rejected at the AEAD check,
  no plaintext media in any relayed frame (run it, don't trust it). Cross-NAT
  evidence is NOT executed: `apps/desktop/nat-lab/README.md` is a runbook for
  two real networks plus a Docker approximation of symmetric NAT.

## What changed on 2026-10-22 (the last central dependencies)

- **Group chat rides a sealed room** (`services/groupRooms.ts`): the node
  keeps the membership, the words are group-sealed and fanned out to the
  members' mailboxes, and the node's rows remain as the older history. The
  UI says which transport a group is on.
- **The social graph is operations**: `follow.add` / `follow.remove`
  (protocol level, with the authorizer rules: no duplicate follow, no
  following yourself, only the follower may undo it) plus the projection.
  The follow button publishes the operation AND keeps the node's row.
- **Reports are operations, and there is no admin in a mesh**: a report about
  peer-replicated content is a signed `report.create`, and it reaches the
  AUTHOR of that content (their notification centre shows "X reported your
  post"). Node-hosted content keeps the node's moderation queue.
- **The update feed travels between peers**: a node serves
  `/release.json` + `/releases/<file>` from `userData/releases`, and
  `npm run dist` stages the built exe there. The updater asks the node it is
  connected to first. No hosted release host is needed any more.
- **Still open**: the mesh-wide moderation story beyond "the author acts"
  (there is no way to force a peer to remove content), and REAL cross-NAT
  evidence (see the 2026-10-22 hardening entry: the two-process relay harness
  is executed, the symmetric-NAT lab is a runbook, not a result). The
  swarm relay fallback IS now end-to-end encrypted (swarm-v1), and profile
  fields are versioned operations — both landed after this entry was written.

## What changed on 2026-10-21 (the hosts went away)

- **Host mode is the default** for packaged builds (`electron/server-mode.cjs`).
  The bundled Bun node is the app's world; the Settings → Server tab switches
  to a friend's node instead of to a hosted default.
- **No hosted fallback anywhere in the client**: `utils/api.ts` resolves to
  the local node, `utils/central.ts` has NO hub by default (a hub is opt-in),
  and the server directory is read from the node you are on (`/api/servers`).
- **Peers on different nodes**: the presence beacon carries the node URL the
  peer lives on (signed), and a sealed envelope is dropped into THAT node's
  mailbox (`utils/peerNodes.ts`, `MailClient.send(..., { base })`). This is
  what makes the mesh work across the open internet without paying for a
  rendezvous: the node you are on is the rendezvous.
- **Comments on peer-replicated posts are now a signed operation** (the L5
  write path) and the feed renders the peer thread merged with the node rows
  (`hooks/usePeerComments.ts`, `utils/commentMerge.ts`).
- **Still open** (unchanged by this round): group chat as sealed rooms, the
  profile/follow graph as operations, moderation reports over the mesh, the
  release feed (the update hosts are gone too — the app says so honestly), and
  the multi-process/NAT evidence.

## Execution order

### L0 — Versioned protocol and threat model

**Purpose:** establish what is signed, encrypted, authorized, replicated, and
considered complete before migrating more features.

Draft contract: [`PROTOCOL-V1.md`](PROTOCOL-V1.md). It is explicitly a
proposal; unresolved decisions and conformance-vector work remain blockers.

- [ ] Write a versioned protocol document covering identity binding, canonical
  serialization, post/comment/reaction/edit/delete operations, tombstones,
  content manifests, key distribution/rotation, access control, expiry, and
  conflict resolution.
- [ ] Define attacker capabilities: malicious relay, malicious peer, replay,
  equivocation, stale peer, compromised identity, storage rollback, resource
  exhaustion, and metadata/traffic analysis. State what the protocol cannot
  hide (e.g. public metadata and peer IPs).
- [ ] Decide which objects are public, private-to-recipient, or group-private.
  Specify encryption at rest and in transit separately; never imply public
  gossip is E2EE.
- [ ] Specify protocol-version negotiation and legacy behavior. Unknown
  versions must fail closed for writes without making old local data
  inaccessible.
- [ ] Define invariants and test vectors for signatures, identity-to-key
  binding, hash/CID computation, ciphertext authentication, timestamps,
  monotonic sequence numbers, and authorization proofs.
- [ ] Review/accept `PROTOCOL-V1.md`, resolve its stated open decisions, and
  check in deterministic language-independent conformance vectors before
  marking L0 complete.

**Acceptance:** reviewable protocol doc plus deterministic valid/invalid test
vectors; no application migration begins until the format and compatibility
rules are fixed.

### L1 — Durable local operation log and outbox

**Purpose:** make a local mutation survive process exit before any network call.

Progress: slices 1–3 exist — `apps/desktop/src/services/socialOperationLog.ts`
(IndexedDB-backed, injectable backend, immutable idempotent appends, monotonic
status, bounded size with delivered-first eviction that never evicts an actor
chain head, oldest-first pending replay, surfaced storage failures) plus
`flushPendingOperations`, the replay driver whose reopen-based tests cover
every crash boundary (before append, after append, mid-send, and
remote-ack-before-status-update, absorbed by operationId idempotence), plus
the publish wiring: every public durable feed post now also commits a signed,
self-authorized, sequence-chained `post.create` operation
(`apps/desktop/src/services/socialPublish.ts`, gated in `mediaForge`).
History validation is gap-tolerant (pruning-safe) but fork- and
wrong-predecessor-strict. 22 service tests pass. Still open: the legacy
`localStorage` outbox remains the product delivery path until the v1 proposal
is accepted; real IndexedDB process-restart evidence and a peer transport for
operations (L4) are required before the log can claim replication.

- [ ] Replace social mutation durability based on `localStorage` with an
  IndexedDB/Electron durable operation store. Keep old keys readable and
  migrate idempotently; do not delete legacy keys before verified copy.
- [ ] Store immutable operation ID, actor ID, protocol version, creation time,
  payload, dependencies, delivery/replication status, retry schedule, and
  tombstone status. Bound payload sizes and queue count/bytes; surface storage
  failures to the caller rather than claiming local durability.
- [ ] Make enqueue atomic with the local projection update, or document and
  test recovery if the existing DB cannot make that transaction atomic.
- [ ] Add crash/restart tests at each boundary: before enqueue, after enqueue,
  during send, after remote ack but before local status update, and during
  migration from old outbox keys.
- [ ] Keep media bytes and metadata referentially consistent: operations may
  not advertise an object before its bytes or a verifiable retrieval source
  are available locally.

**Acceptance:** kill/reopen recovery test proves every committed local
operation replays exactly once logically; quota/DB failure never reports
success; duplicate delivery is idempotent.

### L2 — Authenticated, authorized, durable object transfer

**Purpose:** upgrade byte transfer from opportunistic exchange to safe
replication with truthful acknowledgements.

Progress: the pure receipt primitive exists —
`packages/protocol/src/replication-receipt.ts` (receiver identity binding,
durable-read-back enforcement, per-transfer challenge binding, asymmetric
freshness window; 5 tests including tamper-per-field, wrong-key, non-durable,
and stale/future-dated rejections) — and it is now WIRED into the swarm
handshake: `createSwarmReceiptRoles` (module singleton + per-session
instances) mints a challenge on serve, signs a receipt only after a durable
read-back, and records only challenge-matching valid receipts. Six two-peer
session/module tests cover the full loop plus tamper, stale-challenge,
unsolicited, no-identity, and failed-read-back rejections. Accepted receipts
now persist to IndexedDB (`swarm_receipts`, capped, additive DB v3 upgrade)
and are re-validated + reloaded on boot (`hydrateDurableReplications`), so
replication evidence survives restarts. The swarm
transport already bounds frames/objects and hash-verifies before persistence.
Still open: authorization capabilities for private objects, streaming
backpressure, UI surfacing of "peer-confirmed durable", and the
multi-instance adversarial evidence.

- [ ] Version swarm messages and bind every transfer to object CID/hash,
  manifest version, declared size, MIME, requester/owner identity, and an
  authorization capability when the object is not public.
- [ ] Validate each peer claim independently. A peer must not serve a private
  object merely because it knows its ID; do not trust `HAVE`, sender claims,
  URLs, or relay identity as authorization.
- [ ] Stream chunks with bounded in-flight bytes and backpressure; avoid
  buffering whole large files on both send and receive paths. Set per-peer,
  per-transfer, global byte/count/time limits and cancellation cleanup.
- [ ] Persist and hash-verify before acknowledging durable receipt. Return a
  signed receipt containing peer identity, object hash, durable-store result,
  protocol version, and timestamp. UI must distinguish transfer, local
  persistence, and verified remote durability.
- [ ] Add peer/transport quotas and abuse handling for malformed frames,
  duplicate chunks, conflicting declarations, hash mismatch, slowloris, and
  cancellation; never let invalid bytes contaminate a valid cache entry.
- [ ] Add migration/version interoperability tests for old swarm peers; reject
  unsupported writes safely while preserving read-only compatibility where
  possible.

**Acceptance:** adversarial tests cover authorization bypass, replay, tampered
manifest/chunks, conflicting IDs, oversized frames, repeated HAVE/WANT, peer
disconnect, and persistence failure. A durable receipt is emitted only after
the receipt peer can read bytes back from its persistent store.

### L3 — Independent-peer replication and recovery harness

**Purpose:** prove the protocol across actual application instances instead
of module-level simulated sessions.

Progress: the in-process layer exists — `apps/desktop/src/utils/swarmHarness.ts`
composes fully isolated session nodes (own identity, own durable-store map,
own receipt state machine) over a controllable in-memory network with
partitions, frame duplication, frame drops, and restarts that survive on the
durable store. Four acceptance scenarios pass
(`src/utils/swarmHarness.test.ts`): A→B→C replication with receipts while A
is offline, restart-onto-durable-store with fresh receipts, idempotence
under frame duplication, and mid-transfer partition + recovery. Sessions
gained an injectable awaited `persist` sink (persist-before-attest contract;
module store untouched when present), and duplicate chunk re-delivery is now
an idempotent no-op instead of a fetch failure. Still open: real
multi-PROCESS instances (separate Electron user-data dirs), real
NAT/TURN two-machine evidence, relay-outage/peer-churn beyond the modeled
faults, and lifecycle resource measurements.

- [ ] Build a hermetic multi-instance test harness with isolated user-data
  directories, separate identities, databases, vaults, and transport endpoints.
- [ ] Demonstrate A creates and publishes; B fetches/verifies/persists; A
  shuts down; C discovers/fetches from B; B and C restart and recover the same
  object and operation state.
- [ ] Include at least three independently running nodes, network partition,
  reconnect, duplicate delivery, relay outage, peer churn, and process crash
  during transfer. Assert no central content API is contacted for the tested
  path.
- [ ] Run at least one real two-machine test for discovery/NAT/TURN behavior;
  record OS, network, relay configuration, and logs with secrets removed.
- [ ] Measure idle and active CPU, RAM, disk growth, open connections, and
  shutdown cleanup over a sustained lifecycle test. Set acceptable budgets.

**Acceptance:** reproducible CI or documented operator-run test report with
logs/artifacts; independent stores are verified by read-back, not by a HAVE
message or sender acknowledgement alone.

## Measurements (2026-10-21, this machine)

Numbers, not claims. Reproduce with `npx vitest run src/utils/swarmHarness.measure.test.ts`
(protocol/CPU) and `node scripts/measure-disk.cjs` (real encrypted disk).

**Peer file dissemination** (two isolated peers in one process — protocol and
persistence evidence, NOT NAT evidence):

| measurement | result |
|---|---|
| 4 MiB file, peer to peer | 245–267 ms wall, 234–296 ms CPU → 15–16 MiB/s wall, 12–17 MiB/s per CPU-second |
| wire cost | 820 chunk frames of 5 KiB + 1 WANT + 1 challenge + 1 receipt |
| persistence | the bytes land in the peer's DURABLE store (hash verified) |
| restart | a new session over the same store still holds the file |
| re-seeding | the restarted peer serves the file to a third peer |
| fan-out | 2 MiB to 3 peers → 3/3 durable copies |

**Operation replication wave** (512 signed posts, author signs, peer accepts):

| measurement | before | now |
|---|---|---|
| wave wall time | hung (>15 min) | 4.7 s |
| CPU per operation | O(n²) signature re-verification | 9.55 ms (author 5.14 / peer 4.04) |
| peer store scans | 512 (one per operation) | 1 (whole wave) |
| projection of 512 operations | — | 16 ms |

The three fixes behind those numbers: the authorizer no longer re-verifies the
whole accepted history per operation (`trustedHistory`), the log cache survives
local writes instead of being dropped (per-store revision), and the operation
is verified once instead of twice per hop (`authorizeValidatedOperation`).

**Encrypted image cache** (real disk, AES-256-GCM files under
`<userData>/imgcache`):

| measurement | result |
|---|---|
| write (encrypted) | 40 MiB in 102 ms → 392 MiB/s, 109 ms CPU |
| read + decrypt | 40 MiB in 263 ms → 152 MiB/s, 142 ms CPU |
| disk footprint | 1.00× payload (per-file nonce + tag are negligible) |
| LRU ceiling | cap 8 MiB respected (kept 6 MiB / 3 files) |

### L4 — Feed and post lifecycle migration

**Purpose:** remove API dependence from the core public-feed read/write path
without losing existing posts or weakening moderation/safety behavior.

Progress: the transport seed exists — signed operations now travel between
peers over the swarm channel (`SWARM_OP` frames,
`services/socialOpTransport.ts`). Inbound operations are re-validated
(signature, actor binding, manifest self-consistency, authorization against
the local log's retained history) before a durable append; duplicates are
no-ops; out-of-order operations are rejected until their predecessor lands.
Outbound waves (`broadcastPendingOperations`, wired in `useP2P` on boot and
peer-online) advance entries to 'sending' — never 'delivered', which is only
reached by a peer ACK (`SWARM_OP_ACK`, shape + known-id + actor-match
validated, `applyOperationAck`); long-stuck 'sending' entries become evictable
past a 7-day window (heads still never evicted, gaps stay detectable).

The feed projection exists too: `services/socialFeedProjection.ts` turns
accepted `post.create`/`post.edit`/`post.delete` operations into a
deterministic post list (objectId identity so server/local rows dedupe against
it, edited-head resolution, tombstone hiding, createdAt ordering with an
operationId tiebreak, blocklist filtering of remote tags), and
`hooks/usePeerFeedPosts.ts` merges those rows into the shell feed as
`origin: 'peer'` with `sync_state` derived from the local log status. Media
still resolves through `useObjectImage` (local vault/IndexedDB → signed GET →
swarm with expectedHash), never a provider URL.

Performance: the log now caches its entry list behind a process-wide revision
counter, so replicating a wave no longer costs one full store scan per
operation (previously O(n²) IndexedDB reads); any write from any instance
invalidates every cache with one integer compare. A `BroadcastChannel` signal
extends that to OTHER windows of the same app: without it, a second tab would
authorize operations against a history it no longer had. The comment/reaction
projection now has a READ path too: `projectComments` renders the peer thread
next to the node rows (`hooks/usePeerComments.ts`, `utils/commentMerge.ts`).
Still open: offline read paths beyond the local log, and the
migration/compatibility work below.

- [ ] Define signed, versioned post operations and deterministic feed ordering,
  pagination, edits, deletes/tombstones, reposts, and duplicate/conflict rules.
- [ ] Build a local projection/index over received operations and media
  manifests. Keep the API-backed feed as a compatibility source during a
  staged rollout; merge by stable operation ID and show data origin/status.
- [ ] Change create-post flow to commit locally first, enqueue replication,
  then publish to peers. No network error may remove the local post.
- [ ] Replicate public metadata through peer exchange; private content must
  use explicit recipient authorization and encryption from L0 before sharing.
- [ ] Preserve comments, likes, saves, reports, author/profile rendering,
  sorting, search, pagination, optimistic UI, and local deletion semantics.
  Do not silently leave these on a centralized path while calling the feed
  decentralized.
- [ ] Apply the 18+ blocklist before rendering or re-sharing remote tags/content
  metadata; continue requesting only explicit/adult pools. Keep `shared/
  blocklist.json` authoritative.
- [ ] Test migration of existing server/local posts, offline create/read,
  restart, duplicate gossip, deleted post replay, author-key mismatch, and
  malformed content URLs.

**Acceptance:** core feed reads and post lifecycle work with central stateful
API routes unavailable; old data remains visible/importable; UI labels local,
queued, and replicated states accurately.

### L5 — Comments, reactions, profiles, and social state

**Purpose:** migrate each dependent social feature only after the operation
model and feed projection are stable.

Progress (slice 1 — the model layer): reactions and comments are now signed,
chained operations with the same rules as posts
(`services/socialInteraction.ts`): `reaction.add` / `reaction.remove` (the
removal references the actor's own add operations) and `comment.create` /
`comment.delete`. They are authorized against the accepted history and
committed to the durable log before any network call, and
`services/socialInteractionProjection.ts` projects them into reaction counts
(per target, per actor) and comment threads (nested replies, tombstones
hidden, orphans promoted to top level instead of vanishing).

Deliberate constraint, documented rather than hidden: a reaction or comment
can only target a post/comment that exists in the LOCAL operation log, so
peer-replicated social state applies to peer-replicated content. Posts that
exist only on a node keep using that node's endpoints — there is no hidden
fallback in between. Peer reaction COUNTS are already folded into the feed
rows (`applyReactionsToFeedPosts`), so a replicated post shows the real
number and marks our own like. The WRITE path is live too: liking a
peer-replicated post publishes a signed `reaction.add`/`reaction.remove` in the
durable log instead of calling a node that does not own the post
(`persistLike` → `likePersistenceRoute` → `persistPeerLike`); server posts keep
the node path. The comment box write path is live for peer-replicated posts
too: a signed `comment.create`/`comment.delete` in the durable log, replicated
like every other operation (`persistPeerComment`). Still open: profile/follow
operations, moderation reports, and the import surface.

**Migration of existing content.** `services/socialPostImport.ts` turns the
user's OWN public local posts into `post.create` operations, so the
local-first feed is not born empty. Guardrails: own posts only, idempotent by
objectId, capped per run, additive only (it never touches the post, its bytes
or the vault), and **opt-in** — re-publishing old content to peers is a
visible decision, so nothing calls it automatically at boot.
- [ ] Model comments/replies, reactions, follows, profile fields, and
  moderation reports as authorized signed operations with stable IDs and
  explicit deletion/edit behavior.
- [ ] Keep private profile fields and private-post ACLs out of public gossip.
  Document what profile and social graph metadata is publicly observable.
- [ ] Define conflict resolution for concurrent edits, reaction add/remove,
  and follow/unfollow without relying on a single server clock.
- [ ] Implement one feature at a time with local-first projection, offline
  outbox, replay, migration, and UI tests. Preserve existing UX and provide
  clear unavailable/queued states when peers are absent.
- [ ] Remove each API dependency only after equivalent behavior has passed
  multi-instance and restart tests; retain a deliberate compatibility/import
  path until users can verify migrated data.

**Acceptance:** each migrated feature has independent-node, offline/restart,
conflict, replay, authorization, and migration tests. No hidden central fallback
is required for the feature's core operation.

### L6 — Lobby, chat, and private media

**Purpose:** keep real-time UX while making delivery and authorization
independent of `/api/lobby/chat` and centralized stateful services.

- [ ] Specify group membership, invite/revoke, key epoch changes, sender
  authentication, replay protection, and late-join history policy.
- [ ] Encrypt message bodies and attachment manifests to authorized recipients;
  encrypt group content to a versioned group key. Bind ciphertext to room,
  sender, sequence, and protocol version as authenticated data.
- [ ] Persist outgoing and incoming messages locally before acknowledging
  delivery; define bounded offline mailbox/peer-store behavior and truthful
  delivery/read receipt states.
- [ ] Migrate `/api/lobby/chat`, room history, DMs, attachments, reactions,
  receipts, and notification behavior in separate backward-compatible slices.
- [ ] Add group membership revocation tests proving a removed member cannot
  decrypt future messages; do not promise retroactive secrecy for keys already
  received.
- [ ] Keep identity/private keys in the existing secure identity/vault
  mechanisms; test account backup/restore and key loss without uploading keys.

**Acceptance:** two- and three-peer encrypted chat works offline/reconnects,
survives restart, denies non-members, and does not require central content
storage. Metadata leakage and retention limits are documented.

### L7 — Remaining central dependencies and graceful degradation

**Purpose:** inventory and explicitly migrate or retain every remaining
central service rather than silently treating rendezvous as content authority.

Progress: the inventory exists — [`API-INVENTORY.md`](API-INVENTORY.md) lists
every node route the client calls, with its role (rendezvous / economy /
core-social / media-metadata / legacy / optional / host) and its migration
target. A guard test (`src/utils/apiInventory.test.ts`) scans the renderer for
every `orbitFetch('/api/...')` and fails when a route is not classified, so
the inventory cannot rot into a lie. The economy stays node-authoritative on
purpose (`g$` settlement needs one ordering).

- [ ] Audit `orbitFetch('/api/...')` use in `apps/desktop/src`, classify each
  endpoint as rendezvous, economy/authoritative transaction, import/legacy,
  optional enhancement, or core social state. Maintain the list in docs.
- [ ] Decide deliberately which services stay authoritative (for example,
  economy/duel settlement) and state why those cannot be peer-authoritative.
- [ ] Move profile/directory, notifications, server listings, Lobby, feed
  interactions, and stateful media lookups only when each has a secure
  decentralized equivalent. Do not remove required service endpoints early.
- [ ] Reproduce and document dev API base URL, CORS, 401, 429, 503, and blind
  courier 404 behavior using exact runtime settings. Fix configuration only
  after a failing reproduction identifies the owning layer.
- [ ] Provide offline/error states that distinguish absent data from unavailable
  peers, unavailable rendezvous, unauthorized content, and corrupt bytes.

**Acceptance:** endpoint inventory is current; every API call has an explicit
role and failure contract; core paths have tests with all stateful central
routes disabled.

### L8 — Security, resource, migration, and release gates

- [ ] Threat-review the complete protocol and implementation, including key
  rotation/recovery, compromised peers, Sybil/abuse limits, replay/equivocation,
  stale tombstones, privacy leakage, malicious MIME/content, and disk exhaustion.
- [ ] Verify no telemetry or uploads are introduced. Public booru reads remain
  read-only, adult-rated, and client-filtered by the shared blocklist.
- [ ] Fuzz message parsers and migrations; add property tests for size bounds,
  canonical signatures, replay idempotence, and transaction interruption.
  **Done (first pass):** `src/utils/parserProperties.test.ts` asserts that
  every single-byte mutation of a signed operation is rejected, that random
  operation-shaped objects are rejected, and that 300 malformed swarm frames
  never store bytes.
- [ ] Test on supported Windows and Linux builds. Include upgrade from current
  IndexedDB/localStorage/vault data, rollback/recovery instructions, and
  backup/export verification.
- [ ] Run full lint (0 errors), typecheck, test, build, Electron main standalone
  tests, E2E, and release packaging. Record warnings and environment; do not
  count a flaky full suite as green until rerun or fixed.
- [ ] Update `docs/SPEC.md`, `docs/DESKTOP.md`, and this architecture doc as
  behavior changes. Bump/tag releases only after the repository's release gate.

**Acceptance:** signed-off threat review, migration/rollback evidence,
cross-platform test results, green required gates, and no unverified claims in
UI or documentation.

## Evidence log (2026-10-24, the Cloudflare rendezvous)

- The Render courier and the Fly full node were **removed from the code**:
  `isCourierApiUrl` now knows only `gmatch.pages.dev`; `DEFAULT_CENTRAL_URL`
  points at that courier; `ServersView` has no built-in world row; the legacy
  backfill service/hook, `probe-public-world.mjs`, `fly.toml` and
  `render.yaml` are deleted.
- The rendezvous is `site/functions/api/[[path]].ts` on Cloudflare Pages:
  `GET /api/health` (mode `courier`, services `mail,directory`),
  `GET /api/identity` (`sealed_available:false`), signed directory writes,
  and sealed mail in D1. `/api/posts`, `/api/turn` and every other stateful
  route answer 404 — `site/check.mjs` and the live curls above are the gate.
- Because a Pages isolate cannot notify another isolate's socket, `MailClient`
  detects the courier and polls every 20 s (`mail-client.test.ts` pins it).
- Verified live: health/identity/servers 200, mail roundtrip 202 → 1 → signed
  ack 200 → 0, forged ack 403, directory POST 201 → anonymous list hides the
  endpoint hint → owner DELETE 200.

## Evidence log (2026-10-21, the hosts went away)

- The packaged app no longer resolves to a hosted address: the API base falls
  back to the node on this machine (`utils/api.ts`, `LOCAL_NODE_BASE`), a
  stored URL pointing at a decommissioned host is dropped
  (`isCourierApiUrl` covered both old hosts at the time; both were removed
  from the code on 2026-10-24 — see the next log entry), and the server
  directory is read from the node you are on (`/api/servers`). A stored
  *client mode* that pointed at a dead deployment now migrates to the local
  node (`server-mode-core.resolveServerUrl` + the renderer mirror,
  drift-guarded).
- The presence beacon carries the node URL the peer is connected to, INSIDE the
  signed payload; a rewritten address breaks the signature and the beacon is
  dropped (test: `courierPresence.crossNode.test.ts`). A beacon without the
  field still verifies against the old payload.
- A peer on another node is reachable end to end: the roster reads the
  presence mailbox of every known node (bounded to 8 per round), the sealed
  envelope goes into THAT node's mailbox (`MailClient.send(..., { base })`),
  and the WebRTC signaling follows the same route (`sendCourierSignal(...,
  { base })`).
- Comments on a peer-replicated post are a signed operation
  (`persistPeerComment`) and the feed renders the peer thread merged with the
  node rows, deduped by id (`usePeerComments.ts`, `commentMerge.ts`).
- Gate: lint 0 errors, typecheck clean, desktop suite green
  (260 files / 1,945 tests) and the API/crypto/protocol/shared suites green.
- The E2E `domination.spec.ts` hangs in this environment BEFORE these changes
  too (verified on the pre-change commit `8cbf2f5` in a separate worktree):
  it is a pre-existing environment failure, not a regression. The rest of the
  E2E (including `chat-two-peer.spec.ts`, the sealed DM path) runs green
  against the local node.

## Evidence log (2026-10-20)

- Implemented swarm input/frame bounds, 64 MiB object cap, persistence-before-
  resolve, bounded retry/rehydration selection, and SHA-256 checks for network
  data. Cached RAM bytes with a mismatching expected hash are rejected.
- Public gossip writes and pulled-envelope application bind `author_id` to the
  SHA-256 of `author_pubkey`; route tests cover both boundaries.
- `docs/PROTOCOL-V1.md` now records the proposed operation, authorization,
  content, transfer, compatibility, and threat-model contracts. It is still a
  proposal; protocol-family details and review decisions remain open. A fixed
  Ed25519 identity/signature vector is checked in
  `packages/crypto/src/index.test.ts`; this is only a primitive vector, not the
  full L0 operation/CID/encryption conformance suite.
- An experimental pure operation helper now exists at
  `packages/protocol/src/social-operation.ts`, with fixed operation-ID and
  signature coverage, canonical key-order behavior, strict known operation
  names, exact payload keys and per-type shape bounds, JSON-only bounded
  payloads, sequence-chain checks, and a pure authorizer for ownership,
  current edit heads, tombstones, comment hierarchy, reaction add/remove, and
  binding post manifests to verified owner/CID/MIME/size records. The
  authorizer accepts a complete already-verified history and caller-verified
  manifest map; it does not fetch missing history or resolve forks. It is
  intentionally not connected to application persistence or network paths;
  migration and cross-language end-to-end vectors remain incomplete.
- `packages/crypto` now exposes experimental XChaCha20-Poly1305 DEK helpers
  with caller-provided AAD, plus a v2 recipient-bound DEK wrap (ephemeral
  sender key, domain-separated BLAKE3 KDF binding both public keys and the
  object context, context-bound AEAD). Round-trip, wrong-context,
  wrong-recipient, tamper, malformed-length, and fixed-vector tests pass
  (crypto suite: 12 tests). None of this is wired into media, manifests, or
  the legacy DM envelope; the legacy static wrap stays read-only for existing
  data. Identity-to-encryption-key binding records and key rotation/revocation
  remain open.
- Cross-workspace L0 conformance vectors are checked in at
  `packages/shared/src/social-vectors.ts` and verified by test suites in both
  the protocol package (37 tests) and the API workspace (6 tests), including a
  check that the social-operation and legacy gossip signature domains never
  cross-verify. Full-suite and all-workspace typechecks pass.
- L3 in-process harness (see the L3 progress note): four scenarios pass —
  A→B→C replication with A offline, restart-onto-durable-store, duplicate-
  frame idempotence, and mid-transfer partition recovery. This models the
  protocol contract across isolated node contexts; it is NOT separate OS
  processes or real NAT, which remain L3's open acceptance gate.
- Public durable feed publishes now commit a signed v1 `post.create` operation
  to the durable operation log (`f99661e` protocol-side gap-tolerant
  authorization + manifest hashing; desktop wiring in socialPublish/mediaForge).
  Authorizer semantics: partial histories are legal, forks and wrong
  predecessor bindings are rejected, actor chain heads are never pruned.
- The focused API gossip suite passed (8 tests); workspace typecheck passed;
  lint passed with 0 errors / 47 existing warnings; desktop build passed with
  existing chunk warnings.
- After adding the experimental operation primitive, the protocol package
  suite passed (32 tests) and the crypto package suite passed (11 tests); both
  package typechecks passed.
- Root `npm test` previously had an intermittent failure in
  `GMatchFeed.inline-expand.test.tsx` (different assertions each time, always
  passing solo). Root cause found and fixed: the fixture stamped each post
  with its own `new Date().toISOString()`, so under parallel-worker load the
  two calls could straddle a millisecond boundary, flipping the `latest`
  sort order and making `expanders()[0]` point at the wrong post. The
  fixture now uses deterministic distinct ages (p1 strictly newer than p2).
  After the fix, the full gate is green: 243 desktop files / 1,882 tests,
  crypto 12, protocol 45, shared 21. A duplicate `hexToBytes` import that
  only vitest's parser caught (bun tolerated it) was also removed from the
  crypto test file.
- No independent three-peer durable-replication, process-restart, real
  two-machine NAT, or lifecycle resource evidence is currently recorded.
- The central deployment's stateful API/CORS failure behavior has not yet been
  reproduced with a recorded configuration.

## Completion rule

Do not mark the decentralization effort complete based on protocol helpers,
same-process tests, or successful metadata gossip. Completion requires all
L0-L8 acceptance criteria, preserved user data, real independent-peer restart
evidence, explicit API dependency decisions, and truthful product claims.
