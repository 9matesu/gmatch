# Local-first social protocol — v1 proposal

**Status: proposal; core operation primitive is experimental.** The pure
operation ID/signature/shape helper in `packages/protocol/src/social-operation.ts`
matches the record and domain formula below, but is not wired to persistence,
feed, or peer transport and does not implement operation-specific authorization
or conflict semantics. The current app does not implement this protocol
end-to-end. Do not label existing `gossip-v1`, `SWARM_*`, `localStorage` outbox,
or DM traffic as conforming merely because their names contain “v1”. Existing
wire formats remain supported until an explicit, tested migration is shipped.

## Goals and non-goals

The protocol should let independent desktop nodes commit social operations
locally, exchange them directly or through untrusted relays, verify authorship
and content integrity, enforce recipient authorization, and recover after
offline periods/restarts. Relays may route/store signed public envelopes but
must not become the authority for private content or claim that an object is
durably replicated without a receiver read-back receipt.

V1 does not promise anonymity, traffic-analysis resistance, guaranteed
availability, censorship resistance, protection after endpoint compromise, or
retroactive secrecy after a recipient has obtained plaintext/keys. Public
author IDs, post metadata, peer IP addresses, timing, and connection patterns
may be visible to peers and rendezvous services. Transport encryption does
not replace content encryption or authorization.

## Identity and serialization

- Signing identity is Ed25519. `authorId` is lowercase hex SHA-256 of the
  32-byte Ed25519 public key (64 lowercase hex characters). Receivers recompute
  this value; a payload may not choose an unrelated author ID.
- Encryption identity is a separately generated X25519 key. It is not
  implicitly certified by the Ed25519 key. A future signed identity-binding
  record must bind encryption keys to the signing identity before those keys
  authorize private content. Existing directory/profile fields are hints, not
  proof of binding.
- Protocol records use UTF-8 canonical JSON with recursively sorted object
  keys, array order preserved, no duplicate keys, no non-finite numbers, and
  no `undefined`. The implementation must reject values outside the schema
  before canonicalization. Do not rely on ordinary object insertion order.
- Every signature is domain-separated by protocol, record type, and version;
  e.g. `gmatch-social|1|operation|` followed by canonical record bytes.
  Existing `gossip-v1|...` signatures are a separate legacy domain and are
  verified with their current exact format.
- All IDs/hashes are lowercase hex in canonical records. Parsers may accept
  uppercase only at documented legacy boundaries and normalize before
  verification; canonical v1 records reject noncanonical casing.
- The experimental common-envelope validator accepts only the currently
  enumerated operation names (`post.create`, `post.edit`, `post.delete`,
  `comment.create`, `comment.delete`, `reaction.add`, `reaction.remove`), JSON
  payload values no deeper than 32 levels, and payloads up to 32 KiB. Unknown
  names/types fail closed. These bounds are provisional and operation-specific
  payload schemas still need to be specified before application use.

## Operation record

An operation is immutable and signed by its actor. The following is a shape,
not a finalized TypeScript API:

```json
{
  "protocol": "gmatch-social",
  "version": 1,
  "type": "post.create",
  "operationId": "sha256-of-canonical-unsigned-record",
  "actorId": "sha256-of-ed25519-public-key",
  "signingKey": "32-byte-ed25519-public-key-hex",
  "actorSequence": 12,
  "previousOperationId": "prior-operation-id-or-null",
  "createdAt": 1792454400000,
  "objectId": "stable-object-id",
  "payload": {},
  "signature": "64-byte-ed25519-signature-hex"
}
```

Finalize field limits and exact operation-ID preimage in implementation tests
before using the record in the database. `operationId` excludes the signature
and is computed over the canonical record with `operationId` and `signature`
omitted; its preimage has its own domain prefix. Signature covers every
unsigned field including `operationId`. Actor sequences are monotonic per
signing identity; `previousOperationId` chains an actor's history. Gaps are
allowed during partial sync but must be detectable. Two valid records with the
same actor/sequence and different IDs are equivocation: retain both evidence
records, mark the actor history forked, and do not silently pick a winner.

Wall-clock timestamps are presentation/expiry hints, not trusted ordering or
authorization. Deterministic projections use causal dependencies first and
then a stable operation-ID tie-break where the operation type allows merging.
Types that cannot be safely merged stay visibly conflicted until the actor or
policy resolves them.

## Operation semantics and authorization

- `post.create`, `comment.create`, and `reaction.add` are separate immutable
  operations. A repeated operation ID is idempotent. Similar payloads with
  different IDs are distinct user actions unless a type-specific rule says
  otherwise.
- `post.edit` may be authored only by the post author and references the
  target post plus the version it edits. Concurrent edits do not overwrite
  silently; expose the conflict or resolve with a later author-signed edit
  that names all superseded operation IDs.
- `post.delete` and `comment.delete` are signed tombstones, never physical
  deletion of the operation history. A post author may tombstone their post;
  a comment author may tombstone their comment. Moderation deletion requires a
  separately specified, auditable moderator capability and is not implied by
  a relay decision. Tombstone precedence is monotonic; replaying an older
  create/edit cannot resurrect a tombstoned item.
- Reaction removal references the exact add-operation IDs it removes. This
  makes concurrent add/remove behavior deterministic and prevents a stale
  remove from erasing a later reaction.
- Private operations require an explicit recipient/group authorization proof
  and authenticated encryption. Knowledge of an object ID, `HAVE` message,
  magnet URI, relay response, or sender assertion is never authorization.
- Public post metadata is signed, not secret. Do not distribute a private
  caption/tag/location in a public envelope. Private media must encrypt both
  bytes and sensitive manifest fields; the outer routing envelope contains
  only what routing/authorization requires.

Moderator policy, group membership proof, key rotation/revocation semantics,
and operation-state authorization remain blocking design decisions before
those operation families are implemented.

The experimental validator currently defines these public v1 payload shapes
(exact keys only; all referenced `objectId` values are 1–256 ASCII letters,
digits, `_`, or `-`; operation references are 64-character lowercase hex):

| Type | Required payload fields | Optional fields / limits |
|---|---|---|
| `post.create` | `contentCid`, `manifestHash`, `mimeType`, `sizeBytes` | `caption` ≤2,000 chars; `tags` ≤5 entries, each ≤20 chars |
| `post.edit` | `supersedes` (1–32 operation IDs), plus create fields | same caption/tags |
| `post.delete` | `targetOperationId` (operation ID) | none |
| `comment.create` | `postId`, `parentCommentId` (object ID or null), `body` (1–4,000 chars) | none |
| `comment.delete` | `targetOperationId` | none |
| `reaction.add` | `targetType` (`post`/`comment`), `targetId`, `reaction` (`like`) | none |
| `reaction.remove` | `targetAddOperationIds` (1–100 operation IDs) | none |

`sizeBytes` is 1..64 MiB. `mimeType` is a nonempty string ≤100 chars, not a
content-safety assertion. The helper checks shape only: it does not prove the
referenced manifest exists, that the actor owns a post/comment, that an edit
supersedes the current head, or that reaction removals are authorized. Those
checks require the replicated operation view and must be completed before
network integration.

The experimental pure checker accepts one candidate plus the complete
signature-verified history needed for its references. It rejects a repeated
actor sequence, a missing/mismatched predecessor, and a fork already present
in that history. It does not fetch missing history or merge remote forks;
callers must retain the fork evidence and wait for explicit resolution.
For `post.create`/`post.edit`, callers must also supply the candidate's
manifest in `verifiedManifests`, but only after checking its author signature;
the checker binds owner, CID, MIME, and size to the operation. A caller-provided
map is not itself cryptographic proof and must never be populated from an
untrusted envelope without verification.

### Public-operation authorization and projection rules (proposal)

- `post.create`: the signed actor creates `objectId`; a second create with the
  same ID is a conflict, not an overwrite. The referenced manifest must be
  author-signed by the same actor and its CID/size/MIME must agree with payload.
- `post.edit`: only the post creator may edit. `supersedes` must name exactly
  the current unsuperseded create/edit head operation IDs for that post. A
  concurrent edit creates multiple heads; a later edit may resolve them by
  naming every head. Do not use wall-clock last-write-wins.
- `post.delete`: only the post creator may tombstone it, and
  `targetOperationId` must identify that post's create operation. Tombstone is
  terminal in the normal author model; later create/edit/replay cannot
  resurrect the object. Moderation override is deliberately not defined here.
- `comment.create`: the referenced post must exist and not be tombstoned. A
  non-null parent must identify a comment on the same post and must not be
  tombstoned. The new comment's `objectId` is unique.
- `comment.delete`: only the actor who created the target comment may delete
  it; target and operation `objectId` must resolve to the same comment.
- `reaction.add`: actor creates a unique reaction operation. Target must be a
  live post/comment. V1 permits only `like` and at most one active like per
  actor/target; duplicate adds remain in history but project to one active
  state.
- `reaction.remove`: every target must be a `reaction.add` by the same actor
  and target. Removal is exact-ID based, so a later concurrent add remains
  active. A remove cannot revoke another actor's reaction.

These rules require a validated operation graph. Until that graph/index and
authorization checker exist, the package helper only validates record/payload
shape and signatures; it must not be used as a write authorization decision.

## Content and transfer contract

- Plaintext object CID is SHA-256 of exact plaintext bytes. Encrypted objects
  use a distinct ciphertext CID; a private manifest may carry the plaintext
  digest only inside authenticated ciphertext, otherwise the digest leaks a
  content fingerprint.
- A signed manifest binds protocol/version, owner, object/CID, byte size, MIME,
  chunk ordering and hashes, encryption parameters, recipient key wraps or
  group key epoch, and creation metadata. Validate bounds before allocating or
  persisting. MIME is advisory; renderers still sniff/handle untrusted bytes.
- Private encryption must use a reviewed, domain-separated KDF and
  authenticated encryption with unique nonces. Existing helpers in
  `packages/crypto/src/index.ts` are building blocks, not a protocol approval;
  review key derivation, context binding, nonce handling, and recipient binding
  before use. No new custom cryptography.
- Experimental chunk primitive: `encryptWithDekAndAad` /
  `decryptWithDekAndAad` use XChaCha20-Poly1305 with a random 24-byte nonce
  and caller-supplied AAD. A caller must canonicalize context bytes under a
  separate `gmatch-social|1|content-chunk|` domain and bind at least owner,
  object ID, chunk index/count, plaintext chunk size, MIME, and key epoch.
  Sensitive caption/tags and plaintext content hashes must not be put in
  public AAD. This helper is not yet used by media creation or transfer.
- DEK wrapping/recipient key binding: an experimental v2 wrap
  (`wrapDekForRecipientV2`/`unwrapDekV2`) now matches this contract — ephemeral
  sender X25519 key per wrap, BLAKE3 KDF over domain + shared secret + both
  public keys + caller context, XChaCha20-Poly1305 with that context as AAD.
  It is unwired. The legacy static `encryptPayload`/`wrapDekForRecipient`
  format (no AAD, no forward secrecy) remains only to read existing data and
  must not be used for new private-content v1 writes. Key rotation/revocation
  semantics and a signed identity-binding record for encryption keys remain
  open.
- Transfer request binds requester, object CID, manifest hash/version,
  authorization proof, and fresh request nonce. Chunks bind to that transfer
  and have strict per-object/per-peer/global byte and time budgets.
- The receiver verifies authorization, manifest signature, chunk hashes,
  assembled CID, and authenticated decryption (for private data), then commits
  bytes durably and reads them back before issuing a receipt.
- A replication receipt is signed by the receiving node and binds object CID,
  manifest hash, protocol version, durable-store/read-back result, and a fresh
  challenge/transfer nonce. A HAVE message or successful sender write is not a
  receipt. Product status must distinguish local-only, queued, transfer in
  progress, peer-confirmed durable, and unavailable. Experimental primitive:
  `packages/protocol/src/replication-receipt.ts` (receiver Ed25519 identity
  binding, `durable: true` enforced, asymmetric freshness window — full
  `MAX_RECEIPT_AGE_MS` backwards, `RECEIPT_SKEW_MS` forward so a receiver
  cannot future-date a receipt into validity). The requester's own
  challenge-nonce match remains the primary replay guard and must be enforced
  by the transfer layer once wired; the shape validator alone does not know
  which challenge is outstanding.

## Version negotiation and legacy behavior

- New handshakes advertise supported protocol versions and capabilities. Peers
  select the highest mutually supported version; downgrade is explicit and
  logged. A v1-only authorization/encryption requirement must never downgrade
  into an unauthenticated legacy transfer.
- Unknown versions/types fail closed for writes and private reads. Preserve the
  original record/bytes for export or later software support; never rewrite an
  unknown record as a known version.
- Existing gossip envelopes remain a separate legacy public-post format.
  Current author-key binding is an integrity improvement, not full social
  operation semantics. Existing swarm `HAVE/WANT/CHUNK` is legacy transport;
  it does not prove recipient authorization or remote durability.
- Existing local posts, IndexedDB objects, vault objects, localStorage outbox,
  DMs, and rooms must remain readable during migration. Copy/convert
  transactionally where available, verify counts and hashes, retain source
  records until recovery is tested, and provide rollback/export instructions.

## Threat model

| Threat | Required behavior | Remaining limitation |
|---|---|---|
| Malicious relay changes, reorders, replays, or drops data | Verify signatures, IDs, dependencies, expiry, and idempotence locally; report gaps | Relay can censor or delay delivery |
| Malicious peer sends corrupt/oversized data | Validate schema and bounds before allocation; verify hashes/signatures before persistence; rate-limit/cancel | Peer can consume its allowed bandwidth/CPU budget |
| Peer requests private object by guessing ID | Require recipient/group authorization at serving and receiving side | Authorized recipient can copy plaintext |
| Author equivocates or replays old operations | Detect actor-sequence forks; retain evidence; reject replayed nonces; tombstones do not resurrect | Resolution may require author recovery or user choice |
| Stale/compromised recipient key | Version key bindings and membership epochs; revoke future access | Revocation cannot erase already copied keys/data |
| Local rollback/corruption | Hash-check records/objects and detect sequence gaps; recover from peers/backups | No global authority can prove the latest state during a partition |
| Storage exhaustion or slow peers | Bound queue/object/frame/parallelism/time/disk use; expose persistence failures | Limits may delay sync of large libraries |
| Metadata and traffic analysis | Minimize public/private outer fields; document leakage; avoid false anonymity claims | Peer IPs, timing, sizes, and public graph remain observable |

## Required conformance vectors

Before L0 is considered complete, check in deterministic fixtures for:

1. canonical JSON key ordering and array preservation;
2. valid signature and author-ID derivation from a fixed Ed25519 key;
3. rejection after changing each signed field, signature domain, or version;
4. operation ID preimage and signature preimage;
5. plaintext and ciphertext CID computation, including empty/oversized input;
6. valid authenticated decrypt and rejection on nonce, tag, context, recipient,
   or ciphertext tampering;
7. actor sequence duplicate, gap, replay, and equivocation behavior;
8. valid/invalid post authorization, comment authorization, tombstone replay,
   reaction add/remove, and unknown-version behavior.

Fixtures must be language-independent bytes/hex and pass in both the desktop
and API workspaces. Use fixed known test keys; never put real user keys in
fixtures.

Status: the fixed vectors now live in
`packages/shared/src/social-vectors.ts` (identity/signature, SHA-256 digests,
full signed operation, AEAD content context, recipient-bound DEK wrap) and are
verified by suites in **both** the `@orbit/protocol` package
(`src/social-vectors.test.ts`) and the API workspace
(`src/social-vectors.test.ts`), which also proves the social-operation and
legacy gossip signature domains never cross-verify. Remaining for full L0
sign-off: the actor-sequence duplicate/gap/equivocation vectors are covered in
the protocol suite rather than the shared fixture file, and ciphertext-CID
plus empty/oversized CID edge vectors still need to be added.

## Implementation gates

1. Resolve the open decisions above in a reviewed protocol change. Update L0 in
   `docs/LOCAL-FIRST-ROADMAP.md` only when the contract is accepted.
2. Implement pure canonicalization, IDs, validation, and signature helpers in
   shared packages; add conformance vectors before wiring persistence/network.
3. Implement durable operation storage/outbox (L1) and restart tests.
4. Implement authenticated transfer/receipts (L2) and independent instance
   recovery (L3).
5. Migrate feed/social/chat in the roadmap order. Do not call the target
   complete until L8 evidence is recorded.
