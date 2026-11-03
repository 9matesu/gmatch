# P2P Architecture Alignment — Implementation Plan

> Status: plan of record for the `p2p-alignment` branch (baseline commit
> `3d26d01`, the 1.6.8 working tree preserved first).
> Source material: the read-only architecture audit (2026-11) and the git
> investigation below. No component here is a rewrite; every phase reuses an
> already-shipped subsystem.

## 0. Historical truth (verified from git)

- `2e37446` (2026-09-17) introduced the p2p swarm engine ("resolving objects
  directly between peers"); `8d47bac` (2026-09-18, "release: v1.4.0 full P2P
  media delivery") is the last release where post + identity + media arrived in
  one hop: `IMAGE_ANNOUNCE`/`MESSAGE` frames carried the media **inline as a
  DataURL** with `sender_pubkey`/`sender_enc_pubkey` attached.
- The current model is strictly stronger on identity: signed operations
  (Ed25519, actor binding, manifest binding, verified at ingest —
  `socialOpTransport.ts:18,99`, tamper-rejection tests) and content-addressed
  media (sha256 = object id, chunk hash checks, durable custody receipts —
  `p2pSwarm.ts:652-799`).
- What the old model had and the new one must recover: **the user never saw a
  post arrive without its media when a valid source existed**. The plan claims
  that property by completing the existing SWARM path over WebRTC
  DataChannels, not by resurrecting an unverified transport.

## 1. Confirmed functionality vs assumptions

Confirmed (code/tests cited):

- Signed op log L5.2 with fork refusal and monotonic sequences
  (`socialOperationLog.ts:411-420`).
- Inbound op validation: shape, signature, actor identity, manifest claim
  (`socialOpTransport.ts` + tests; tampered ops are `rejected`).
- Idempotent own-post import by objectId; own posts only
  (`socialPostImport.ts:16-53`).
- SWARM_HAVE/WANT/KEY/CHUNK with swarm-v1 AEAD (per-transfer DEK sealed to the
  fetcher's ephemeral key, XChaCha20-Poly1305 chunks, AAD binding
  object/transfer/index/fetcher), legacy plaintext default-deny (`p2pSwarm.ts`).
- Chunk integrity + sha256-vs-objectid verification before persist; duplicate
  chunk re-delivery is an idempotent no-op.
- Durable custody receipts: challenge-bound, read-back-verified, persisted and
  re-validated on boot (`p2pSwarm.ts:652-799`).
- Keepsake restoration pipeline with read-back verification
  (`services/keepsake.ts`, circuits tested in `keepsake.test.ts`).
- Two-process harness executing the production engine with an untrusted relay
  (`apps/desktop/scripts/p2p-two-process.mjs`).
- Boot persistence: pending transfers resume (`gmatch_pending_transfers_v1`),
  receipts re-hydrate (`hydrateDurableReplications`).
- Transport-state machine with validated `direct` promotion, bounded retries,
  honest labels (`utils/transportState.ts` wired in `hooks/useP2P.ts`).
- Wipe-proof local storage: media-vault (content-addressed, AES-GCM) + node
  blob store + IndexedDB seed.

Assumptions (must be verified by the tests of the phase that uses them):

- A2. DataChannel-open peers can carry `SWARM_KEY`/`SWARM_CHUNK` frames within
  message-size limits — assumed feasible because a sealed chunk frame is
  already ≤8 KiB; proven by Phase 2's harness case.
- A3. `broadcastRecentOperations` (peer-online re-offer, newest 120, ≤7 days,
  20s throttle) is sufficient as the *metadata* retrigger; the *media*
  retrigger (under-replicated objects) does not exist yet and is Phase 3.
- A4. All renderers now resolve vault/local first (`770c694`); Phase 4 audits
  every consumer rather than assuming.
- A5. Only 9/244 fly-media objects are recoverable on this installation;
  other installations are unverified recovery sources (Phase 5 measures).

## 2. Phase sequence (with files, reuse, regressions, tests)

### Phase 0 — baseline (done)

Branch `p2p-alignment`; baseline commit of the 1.6.8 tree; full gate
(typecheck/lint/test) green before any phase commits.

### Phase 1 — behavioral reference test (Priority 1)

Prove the end-to-end desired behavior as a runnable artifact, extending the
existing two-process harness (real processes, untrusted relay):

1. A signs `post.create` (objectId = content id) and publishes it; A also
   seeds the bytes.
2. B accepts the op (signature/actor checks), sees the media it lacks.
3. B issues `SWARM_WANT` (offerPub); A answers `SWARM_KEY` + `SWARM_CHUNK`s.
4. B verifies AEAD + sha256, persists (`registerLocalObject` → vault),
   read-back verifies, stores a custody receipt.
5. B restarts its engine (fresh state, durable store only) and resolves the
   post's media from the local store — post → media in one user-visible
   behavior.

- Reuse: `p2p-two-process.mjs` harness; `socialPublish`/`acceptInboundOperation`;
  `registerLocalObject`, `sha256HexBlob`, `purgeSwarmObject` seams;
  `keepsake.ts` store adapter.
- Files: `apps/desktop/scripts/p2p-two-process.mjs` (extend), optional
  `apps/desktop/scripts/p2p-behavior.mjs` if separation is cleaner.
- Regressions: none to shipped code (test-only). The test becomes the refusal
  gate for any later phase breaking user-visible behavior.
- Tests: the harness itself (pass criteria a–e above, byte-identical,
  restart-survives, no plaintext at the relay).

### Phase 2 — SWARM over DataChannel (Priority 5, main transport task)

Route the full frame set (`HAVE/WANT/KEY/CHUNK/CHALLENGE/RECEIPT`) over the
existing validated DataChannel mesh, transport chosen per delivery, not per
protocol:

- Frame emission goes through one send seam keyed by transport phase;
  `broadcastMeshFrame` (`courierSignaling.ts`) and the WS relay
  (`{type:'SWARM_FRAME'}`) are both emission targets — no new frame types, no
  new encryption, no new chunking.
- Backpressure: a per-channel bounded send queue (monitor `bufferedAmount`,
  high-watermark pause, low-watermark resume) for chunk bursts; the queue
  yields, it never unbounded-buffers.
- Interruption: a dropped channel moves the peer to relay phase (existing
  transport registry) and pending transfers resume over the next path
  (`gmatch_pending_transfers_v1` already resumes on boot/peer-online).
- Resumability + dedupe: already-landed chunks are no-ops (existing
  idempotent re-delivery); a fetch keeps per-chunk received-indices so a
  resumed transfer only asks for missing indices.
- Transfer state is transport-agnostic by construction: fetch/seeder logic
  stays in `p2pSwarm.ts`; the transport layer never sees chunk payloads as
  anything but opaque frames.

- Reuse: framing/encryption/receipts in `p2pSwarm.ts`; mesh channels +
  registry in `courierSignaling.ts`/`transportState.ts`; relay in `useP2P.ts`.
- Files: `apps/desktop/src/utils/p2pSwarm.ts`,
  `apps/desktop/src/utils/courierSignaling.ts`,
  `apps/desktop/src/hooks/useP2P.ts`, piecewise tests next to each.
- Regressions: relay-only swarms (two tabs on one node) must keep passing;
  duplicate-seeder races stay bounded (`MAX_TRANSFER_KEYS`); frame-splitting
  threshold respected on the relay path.
- Tests: harness case "chunks ride a direct channel" (two engines + a stubbed
  channel-mode transport), interruption mid-transfer (resume to completion,
  no duplicate object), backpressure pacing with a slow consumer, plus all
  existing swarm suites.

### Phase 3 — replication targeting + HAVE-retrigger (Priority 6)

- Under-replicated re-trigger: when a peer comes online, advertise a bounded
  slice of objects whose verified distinct custody holders < target (3),
  excluding this node's own held set, via the existing 10s-throttled wave.
  "Distinct" = distinct `orbitId`s in persisted receipts; a receipt exists
  only for persisted, read-back-verified bytes (accepted-history semantics
  unchanged).
- Peer selection: from the validated/relay roster, closest to online; retry
  with existing exponential backoff; offline holders produce no false
  promise — availability is per-object custody status, never claimed globally.
- Prioritization: bounded (≤3 in-flight WANTs) stays; under-replicated
  historical objects outrank fresh speculative hydration.

- Files: `apps/desktop/src/utils/p2pSwarm.ts`,
  `apps/desktop/src/hooks/useP2P.ts` (+ tests in `p2pSwarm.*.test.ts`).
- Reuse: SWARM_HAVE waves, receipt store, `getDurableReplication`.
- Regressions: no HAVE storm (throttle invariants asserted), no speculative
  full-library fetch, receipts capped store stays 256.

### Phase 4 — media resolution order (Priority 4)

Audit every media consumer (feed tiles, stories, gallery, profile, slideshow,
cards, watch party, notifications previews) and converge on one resolution
priority: (1) media-vault object by id → (2) local node blob store → (3)
verified P2P source (swarm fetch) → (4) remote URL if applicable; then honest
states (`cached/downloadable/retryable/missing/corrupt`) surfaced from the
recovery statuses of Phase 5 (no invented bytes, tile stays visible).

- Extend `770c694` ("resolve vault media by object id") — same approach, full
  coverage; `useObjectImage` inflight-dedupe/prefetch semantics unchanged.
- Files: `apps/desktop/src/hooks/useObjectImage.ts`,
  `apps/desktop/src/utils/media.ts`, per-consumer call sites as found; media
  honesty tests extended (`media.test.ts`, `swarm404` test).
- Regressions: rendering must not gain synchronous vault churn (existing LRU
  bounds hold); descriptor rows keep their non-destructive recovery.

Delivered — `useObjectImage` was already the canonical order and its 13 hook
consumers (feed tiles, slideshows, admin media, match surfaces, watch party)
converge through it. Two node-only bypasses fixed in place, overlaying the
same order without a second engine: the shared vault→swarm-store ladder
`utils/localMedia.ts` (`localHeldMediaUrl`, no network) is now ① the front of
`resolveWallpaperUrl` (App) for object refs — including mapping
`urn:sha256:<uuid>` onto `/api/objects/<id>`, which previously fired a doomed
raw fetch — and ② the `CardZoomModal` open-original button before its signed
node stream; nesting still mutates nothing and the swarm ASK stays absent on
purpose (wallpaper is never a fetch priority). Documented-intentional, left
as-is: `Avatar` remaps `/api/objects/` to the node pfp route by design;
`BabecockPanel`/`ImageViewer` render booru/keepsake sources the hook does not
own, and `handleDownload` stays node-only (a download wants fresh bytes).

### Phase 5 — historical recovery campaign (Priority 3)

Idempotent recovery service over the *existing* pipeline, statuses derived,
never fabricated:

1. Load metadata manifest (metadata always preserved; per-object status).
2. Local match: media-vault / blob store / IndexedDB by content hash — match
   by hash only. `imgcache` is fnv1a-URL-keyed, not content-addressed, so it
   is **not** a match source (measured: 0 hits); it is scanned only via its
   `vault.get` eviction path when a vault record exists.
3. Verify expected sha256 → `registerLocalObject` → vault persist → read-back
   verify → announce via `announceHeldObjects` (existing wave).
4. No valid local source → `downloadable` while seeder(s) exist (swarm side:
   Phase 2/3 machinery answers when a peer carries it); `retryable` after a
   failed attempt; `missing` with no known source; `corrupt` when bytes fail
   verification. Statuses are re-evaluated on every scan + peer-online wave —
   a `missing` today is not a tombstone.
- Idempotency: keyed by content hash; re-running a scan registers nothing
  twice (keepsake guardrails apply).
- Never scan arbitrary personal directories; app-owned stores only.
- Files: `apps/desktop/src/services/mediaRecovery.ts` (new, thin — it
  composes keepsake + manifest + swarm; not a new pipeline),
  `apps/desktop/src/services/recoveryStatus.ts` (status enum + derivation),
  tests beside them. Manifest import stays the existing out-of-repo signed
  reader.
- Regressions: no boot-time network flood — the campaign runs bounded and
  throttled, opt-in per installation.

Delivered — two new thin units beside their tests (17 cases, green):
`services/recoveryStatus.ts` (enum + `deriveStatus` — pure precedence,
corrupt > cached > retryable > downloadable > missing, every rule from an
evidence shape a scan can actually prove; nothing networked, nothing stored,
nothing tombstoned) and `services/mediaRecovery.ts` (`scanMediaRecovery` —
bounded batch of 8, 30s wall-clock throttle, empty input short-circuits;
matches the register by content hash then id, verifies sha256 → `corrupt`
on mismatch, aliases both identities, and covers a recovered batch with ONE
`announceHeldObjects` frame; a content-hash-KEYED vault row is a match by
the key itself; a miss re-reads the existing `pendingTransfers`
bookkeeping — attempts>0 → `retryable` — and enqueues fresh misses for the
existing resume machinery, idempotently (shared store; a re-run re-reads
and never double-enqueues, registers twice, or invents bytes). Fully
injectable deps like keepsake; magnet ids and empty ids filtered; app-owned
stores only. `imgcache` remains excluded as a match source per plan A5.
Wiring (which manifest drives a scan, and the peer-online re-eval) is
Phase 6 Stage D/E — the campaign itself is the verifiedEngine all callers
compose.

### Phase 6 — migration reconciliation (Priority 7 Stage D/E)

- Stage D: watermark cursor (`created_at`) on the manifest; reconcile new
  posts/uploads without duplicating (objectId dedupe) and without re-signing
  or re-authoring anything.
- Stage E: verification table per object — `recovered+replicated` /
  `recovered (under-replicated)` / `metadata only` / `corrupt`. Never report
  metadata import as media migration; the report is the Stage E artifact.

Delivered — `services/migrationReconcile.ts` beside 9 tests (green): Stage D
is a monotonic `created_at` watermark (`WATERMARK_KEY`, never rewinds — a
stale manifest cannot re-watermark newer work) with the next bounded slice
of the manifest deduped BY objectId (one repeated post is one row carrying
its newest metadata) ordered oldest→newest and bounded (8/pass default);
stage E's `classifyStageE`/`buildStageE` derive one honest class per object
from the Phase 5 scan status + Phase 3 distinct custody holders:
`cached` ≥ 3 holders → `recovered+replicated`; `cached` < 3 → `recovered
(under-replicated)`; anything not locally verified (downloadable/retryable/
missing) → `metadata only`; `corrupt` → `corrupt`. Nothing in the unit
signs, re-authors, uploads or mutates metadata — the report rows are the
artifact, and the totals distinguish MS import from media migration
outright. localStorage-backed watermark follows the repo's stubbed
convention in tests.

### Phase 7 — cleanup (Priority 8, only after post-verification)

Exact removal list (each gated by its own test, no drive-by refactors):
PeerJS ghost stack; unused `/api/turn` + site flag; legacy `/api/pm`
compatibility tree (post-verification window); gossip-v1/SWARM_OP duality
reconciled; unbounded outbox `local` entries; chunk buffer idle sweep;
`relayRef.destroy()` on unmount; node/courier auth parity test; RAM-only node
mail store → SQLite; plaintext `blobs/` vs ciphertext content-type handling.

### Phase 8 — independence verification (Priority 9)

Block Fly.dev at the network level (host firewall / DNS sinkhole), run:
existing users, historical posts, local media resolution, new publication,
peer discovery, direct transfer, 3-peer replication, restart+recovery,
offline behavior, missing-media honesty — the E2E suite plus the reference
behavior test of Phase 1. When every gate passes, remove the remote-node
compatibility strings. Only then close the migration.

## 3. Non-goals

- No resurrection of the DataURL transport.
- No new chunk-transfer protocol, replication engine, cache or identity layer.
- No booru/database guessing for missing fly media; honest states only.
