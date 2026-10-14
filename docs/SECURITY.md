# gmatch 1.5.5 — Security

> Authoritative for this line. No claim here exceeds what the code does.

## 1. Threat model

- **Malicious peer:** envelopes are re-validated on receipt (shape, author-sig,
  id binding, authority scope). A relay cannot forge authorship; forwarding
  confers no authority. Forward fan-out is bounded (≤8, once-only) with SSRF
  deny-listing so one record cannot turn the mesh into an amplifier.
- **Replay:** content-addressed ids dedupe; reaction versions apply strictly
  monotonically; withdrawals are terminal tombstones checked before inserts.
- **Unauthorized access:** per-node bans stay local and never gossip (a
  gossiped ban would be a censorship primitive). Content takedowns are
  hash-scoped, advisory, and verifiable without trusting the issuer.
- **Compromised credentials:** node key rotation heals via re-announce;
  a leaked room DEK exposes that room's history (no forward secrecy — stated,
  not fixed).

## 2. Identity, keys, local data

- Private keys never leave the device (DPAPI/`secure-kv.bin`, or browser
  `localStorage` in dev). No telemetry, no personal-data upload; media bytes
  leave disk only via swarm fetches.
- ICE hygiene: only mDNS `.local` + TURN relay candidates cross the wire;
  `srflx`/`prflx`/literal-IP hosts dropped client-side and re-gated
  server-side. Tracker URLs derived in main, never from the renderer.
- Media entering/leaving is metadata-stripped; tags live in the DB, never in files.

## 3. What observers can see

- **Peers:** your public key, orbit id, display name/avatar you publish,
  envelopes you author, infohashes you announce to shared trackers (peer
  address visible to tracker by protocol — announce only to trusted trackers).
- **Courier/relay (1.5.5):** opaque sealed bytes, delivery tokens, timing and
  volume. Cannot read bodies, sender identity, or kinds. Lost on cold start
  (ephemeral disk) — senders retry from durable outboxes.
- **libp2p relay (target):** same discipline required — relay must see only
  ciphertext + routing headers; this is an acceptance check before the move.

## 4. Explicit non-claims

No anonymity (public keys + tracker announces are linkable), no forward
secrecy for rooms, no global enforcement of takedowns, no protection against
a host that ignores tombstones. The local blocklist is the enforcement users
actually control.
