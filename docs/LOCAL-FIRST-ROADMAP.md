# Local-first / decentralized implementation backlog

This is the execution plan for moving gMatch from its current hybrid
architecture toward a genuinely local-first, peer-replicated social app. It is
an implementation backlog, not a claim that the target architecture exists.
Keep tasks small and independently reviewable. For each code task: add a
regression test first, update the behavior-owning document in the same change,
run the narrow checks, then commit only the files in that slice.

## Current state and constraints

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
- Public posts/media are not end-to-end encrypted. Keep the existing DM
  envelope unless a concrete cryptographic defect is shown; do not silently
  change its wire format.
- The central deployment is configured as a blind courier and returns 404 for
  stateful routes. Do not make it a content host or open remote CORS as a
  workaround. Reproduce API routing/configuration errors against a recorded
  runtime before changing them.
- Do not remove, rewrite, or migrate user data destructively. Add versioned,
  idempotent migrations and preserve legacy records until tested recovery is
  demonstrated. The single age gate and client-side prohibited-tag blocklist
  remain mandatory.

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

### L4 — Feed and post lifecycle migration

**Purpose:** remove API dependence from the core public-feed read/write path
without losing existing posts or weakening moderation/safety behavior.

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
  payloads, and basic sequence/previous-ID shape checks. It is intentionally
  not connected to application
  persistence or network paths; operation-specific authorization, encryption,
  migration, and cross-language vectors remain incomplete. Public-operation
  authorization/projection rules are written as a proposal but are not yet
  enforced against an operation graph.
- `packages/crypto` now exposes experimental XChaCha20-Poly1305 DEK helpers
  with caller-provided AAD. Round-trip and context/ciphertext tampering tests
  pass. They are not wired into media or DEK wrapping; encryption key binding,
  wrapping, rotation, and deterministic cross-language AEAD vectors remain
  open.
- The focused API gossip suite passed (8 tests); workspace typecheck passed;
  lint passed with 0 errors / 47 existing warnings; desktop build passed with
  existing chunk warnings.
- After adding the experimental operation primitive, the protocol package
  suite passed (28 tests) and the crypto package suite passed (9 tests); both
  package typechecks passed. After adding the AAD encryption helper, crypto
  tests passed (10) and crypto typecheck passed.
- Root `npm test` had one failure in
  `GMatchFeed.inline-expand.test.tsx` (reply button inaccessible); rerunning
  that file alone passed all 7 tests. Treat the full-suite result as flaky/not
  green until reproduced and the root cause is understood.
- No independent three-peer durable-replication, process-restart, real
  two-machine NAT, or lifecycle resource evidence is currently recorded.
- The central deployment's stateful API/CORS failure behavior has not yet been
  reproduced with a recorded configuration.

## Completion rule

Do not mark the decentralization effort complete based on protocol helpers,
same-process tests, or successful metadata gossip. Completion requires all
L0-L8 acceptance criteria, preserved user data, real independent-peer restart
evidence, explicit API dependency decisions, and truthful product claims.
