# gMatch, Security Audit (static pentest)

**Scope:** white-box of the source across four rounds (branches `security/audit-hardening`, `feat/encrypted-api-servers`, `fix/logic-consistency-sweep`, `security/wave2-ip-masks`): Electron desktop app + Hono/Bun API + `@orbit/crypto|protocol`. There was no deployed target for dynamic testing, every claim below cites verifiable code; the "Prove" commands reproduce each finding.

**Methodology:** persistence surfaces (disk, localStorage/LS leveldb, IndexedDB, Chromium cache, server SQLite snapshot), transport (signed REST, WS swarm, courier WS, WebRTC/ICE, TURN), authentication and access control, cryptographic primitives and the envelope protocol, threat model (a) user-disk forensics, (b) user-level malware, (c) server operator, (d) network MITM, (e) admin-panel abuse.

## Round 1 (2026-09-09, v1.0)

| # | Sev | Finding | Prove | Status |
|---|-----|---------|-------|--------|
| F1 | HIGH | Adult image cache persisted **plaintext on disk**: `<userData>/image-cache/<fnv1a(url)>.<ext>` + `meta.json` (~150MB/250 files LRU) + `feed-cache.json` (tag-query responses, 10min TTL). | `grep -n "writeFileSync(path.join(cacheDir" apps/desktop/electron/imageCache.cjs` | ✅ fix B.1, in-memory LRU + destructive migration that wipes the old cache |
| F2 | HIGH | Objects/media served with `Cache-Control: public, max-age=31536000, immutable` → Chromium disk cache + intermediaries. | `grep -rn "max-age=31536000" apps/api/src/routes/objects.ts` | ✅ fix B.2, `no-store` on every content response |
| F3 | HIGH | Identity private keys (Ed25519 + X25519) in **plaintext localStorage** (`orbit_identity`). | `grep -n "orbit_identity" apps/desktop/src/hooks/useIdentity.ts`; no `safeStorage` in the repo. | ✅ fix B.3, `safeStorage` (DPAPI) with destructive migration |
| F4 | MEDIUM | Admin PIN with **hardcoded fallback** (`ADMIN_PIN \|\| 'Ionwarehouse1'`), plaintext comparison, no lockout. | `grep -rn "Ionwarehouse1" apps/api/src/routes/admin.ts` | ✅ fix B.4, no env → admin 503; hash + lockout |
| F5 | MEDIUM | LEGACY mode (full-node/self-host): DMs use AES under the **server's** storage key (it decrypts to deliver), not E2EE. On the official SITE the legacy inbox does not exist (404 gate); the path there is the E2EE courier. | `apps/api/src/pm.ts:6,136` + `crypto.ts:7-16` | 📋 documented product decision (see "Per-mode model"); `e2e-disclaimer` explains it to the user |
| F6 | MEDIUM | No automated proof that SITE mode never touches content tables (the SQLite snapshot only exists for full-nodes). | new `apps/api/src/site-blindness.test.ts` | ✅ fix B.6, end-to-end verification test |
| F7 | LOW | CSP `connect-src` with wildcards `*.workers.dev`/`*.fly.dev`; `style-src 'unsafe-inline'`. | `sed -n 24-27p apps/api/src/middleware/security-headers.ts` | ✅ fix B.5, exact origins via `CSP_CONNECT_ORIGINS` (inline style kept only in dev, documented) |
| F8 | LOW | Courier threads/rooms and PFPs (data-URL) in plaintext localStorage. | `grep -n "orbit_mail_threads\|goonmatch_pfps" apps/desktop/src -r` | ✅ B.3, secure KV (DPAPI) for all content stores |
| F9 | LOW | (same as F8, pfp) | idem | ✅ |
| F10 | INFO | Streaming signed-URLs with 7h TTL in the query (`?sig&exp`), history-leak risk. | `grep -n "ttlSeconds" apps/api/src/crypto.ts` | ✅ fix B.7, 15min TTL + single-use jti (replay/legacy-URL dead) |

## Verified controls that ALREADY existed (positives)

- **Auth:** Ed25519 signature over `method|url|timestamp|nonce|body` on every mutation; timestamp window; server nonce + replay-block; `orbitId = sha256(pubkey)` re-hashed server-side. `apps/api/src/middleware/auth.ts`.
- **Envelope v2 E2EE** (`packages/protocol/src/envelope.ts`): body + sender identity INSIDE the seal; Ed25519 binding over `v2|kind|id|to|body` (anti-rebinding of kind/recipient); X25519-ECIES + XChaCha20-Poly1305 + BLAKE3 KDF (13 tests).
- **Blind courier** (`apps/api/src/mail-store.ts`, `routes/mail.ts`): SHAPE validation only; bytes stored verbatim; ack only with key-ownership proof (a token-guesser cannot drain someone else's box, forged-signature test); WS 100% anonymous (no frame declares identity); TTL + anti-flood caps.
- **TURN** (`routes/turn.ts`, `turn-creds.ts`): username `<rand16hex>:<exp>`, relay logs do NOT link traffic to identity; standard coturn HMAC auth-secret; no creds → STUN-only, no hardcoded third-party relay.
- **ICE hygiene** (`apps/desktop/src/utils/ice-hygiene.ts` + tests): host/srflx candidates with literal IPs dropped at the source on both stacks; only mDNS `.local` + relay.
- **SSRF guard** (`apps/api/src/proxy.ts:34`, `routes/objects.ts:128`): loopback/link-local/private ranges blocked on the external-URL proxy.
- **PII in logs** (`security-headers.ts: redactIp`): X-Forwarded-For/X-Real-IP redacted.
- **X-Frame-Options DENY; Referrer-Policy no-referrer; COEP strict** (`security-headers.ts`).
- **At-rest AES-256-GCM** for blobs and PMs on the full-node (a SQLite dump does not yield plaintext), defense in depth for F5.
- **Inescapable 18+ age gate** on first run + **hard tag blocklist** enforced in the main process (SPEC §8), CSAM/incest/animals/non-consent etc. blocked at the origin of every booru request.
- **SITE_SERVICES** (`site-services.ts` + tests): in site mode, ALL content routes (pm, posts, objects, users, signal, lobby…) and the legacy swarm WS answer 404 at the edge.
- **Account deletion** (`users.delete('/account')`) and story expiry (12h) + periodic cleanup (`cleanup.ts`).
- **No telemetry**: zero analytics requests in the app; `grep -rn "analytics\|sentry\|beacon" apps/desktop/src` → 0.

## Threats modeled → coverage

| Threat | Mitigation in code |
|---|---|
| (a) User-disk forensics | F1/F2/F3/F8 → runtime-only: images in RAM only, `no-store`, keys and threads in DPAPI, local `storage.key` |
| (b) User-level malware | DPAPI does not help (same session), mitigated by: key export only via explicit modal + `will-prevent-unload` warning; honest limit stated in the ToS |
| (c) Server operator | Blind courier + envelope signature + public token + random TURN + ICE hygiene + SITE gate: the official host does NOT see content, conversation identity, presence, or the graph. Full-node: the HOST IS the server, and `e2e-disclaimer` says so |
| (d) Network MITM | TLS on the API + payloads already E2EE; replay protected by nonce/signature; CSP without arbitrary origins (F7 fixed) |
| (e) Admin abuse | PIN hashed + lockout + no default (F4); wave 2 adds identity binding + 12h grant TTL (F22); content unseal only via victim key-disclosure (implemented: report-scoped cases) |

## Per-mode model (F5, recorded decision)

- **Official SITE (`SITE_SERVICES=mail,turn`)**: pure courier. The server is stateless for content (no table ever written; see `site-blindness.test.ts`), keeps opaque envelopes for ≤7d and does not know who connects.
- **Self-hosted full-node**: LAN/community convenience: the HOST'S ADMINS see PMs/blobs with their own key, like any historical central server. It is not "their server"; it is yours. ToS + disclaimer make this explicit.

## Limitations / out of reach

- No forward secrecy (static X25519 per account), ratchet/prekeys remain future 1.x hardening.
- No onion-routing, residual traffic×time correlation on any courier (mitigated client-side with padding/jitter; not eliminable).
- The audit is static: it does not replace third-party dynamic pentesting or human counsel review for the legal side.

## Runtime-only checklist (how to verify today)

```bash
# 1) no image on disk after running the app:
ls "$APPDATA/@gmatch/desktop/image-cache" 2>/dev/null; echo "exit=$?"   # expected: missing / exit≠0
# 2) responses without cache:
curl -sI "$API_BASE/api/objects/<own-id>" | grep -i cache-control          # no-store
# 3) no key in localStorage:
#    (open the app's DevTools) localStorage.getItem('orbit_identity')       # null
#    encrypted file: <userData>/identity.bin (DPAPI)
# 4) admin disabled without env: POST /api/admin/verify-pin → 503 without ADMIN_PIN_HASH
```

## Round 2 (2026-09-09, v1.1+ / branch feat/encrypted-api-servers)

| # | Sev | Finding | Repro | Status |
|---|-----|---------|-------|--------|
| F11 | HIGH | Signed mutations traveled with JSON body + headers in **plaintext**, any network MITM/observer saw the body, path and the user's target route. | `grep -n "X-Orbit-Signature" apps/desktop/src/utils/api.ts` | ✅ fix T2, ECIES to the node's X25519 key (`GET /api/identity`), header `X-Orbit-Sealed`; body/headers readable only at the node (tests `packages/protocol/src/api-seal.test.ts`, `apps/api/src/middleware/unseal.test.ts`, `apps/desktop/src/utils/api.seal.test.ts`) |
| F12 | MEDIUM | No access control on **creating/joining** servers: any key could pollute the directory or impersonate a host. | new `apps/api/src/routes/servers.test.ts` | ✅ T3, registration requires orbitAuth Ed25519; endpoint hint revealed only to signed callers; 5/max-owner; stale 24h |
| F13 | LOW | Node userlist exposed precise last_seen. | `GET /api/servers/dashboard` anonymous | ✅ T4, anonymous = counts only; members = truncated id (8) + 60s boolean |
| F14 | MEDIUM | Private servers without a password = any discovered key could write (orbitAuth auto-creates Users!). | new `apps/api/src/routes/password.test.ts` | ✅ T5, scrypt in the host's SystemMeta + write gate for newcomers (signed allowlist, epoch grandfathered, lockout 5/15) |
| F15 | LOW | Server handoff without a secure backup mechanism. | new `apps/api/src/routes/snapshot.test.ts` | ✅ T6, `/api/snapshot` admin-only, content allowlist, never exports SystemMeta/Sessions/ServerDirectory |

Honest open items from round 2: automatic multi-replica replication NOT
implemented (manual export/import covers v1; see ADR-002). The
`API_SEALED_ONLY` kill-switch still accepts legacy signed requests (support
mitigation, documented). B.7 (signed URLs) remains closed from round 1.

## Round 3 (2026-09-10, v1.1.3+ / branch fix/logic-consistency-sweep)

| # | Sev | Finding | Repro | Status |
|---|-----|---------|-------|--------|
| F16 | HIGH | `idle-credit` accepted ANY integer 1..1M per 60s throttle, the SPEC called the ledger "authoritative", but the earning-rate validation existed only client-side (a malicious player forged g$ on shared/federated nodes; rankings became fiction). | historical `economy-idle.ts` (no gate) | ✅ server-side envelope: `idleEnvelope` = 1.5× claimed rate × elapsed + 5 (claim ceiling 50k/s); the node's first post-boot flush is trusted by design. Tests `economy-idle.test.ts` (16). Honest scope: on YOUR node it disciplines crashes; on other people's nodes it caps cheating at the documented ceiling, it does not eliminate it. |
| F17 | LOW | `buyCard` has blocked self-purchase of one's own listing since the scaffold (guard + test existed), but StoreTab offered an active Buy button on your own listing (confusing 403 on click). | `grep "own card" apps/api/src/cards.test.ts` | ✅ "Yours" badge replaces the button (honest UI; the server was already right). |
| F18 | MEDIUM | Paid hack debuffs lived in an IN-MEMORY ARRAY, restarting the sidecar (every app relaunch!) ate the victim's active effect and the attacker's already-charged g$ spy-feed session. | `grep -n "activeServerHacks" apps/api/src/routes/users.ts` (historical) | ✅ `HackDebuffs` table (migration 048): INSERT via the debit's atomic batch (gate `changes()`), prune/reads via DB; account cleanup + snapshot allowlist wired. "Survives module re-init" test (`spy-feed.test.ts`). |
| F19 | LOW | Never-acked Domination actions (victim closed the app; OS blocked the camera) stayed `sent` forever, honest UI ("awaiting") but no terminal state. | old `SELECT count(*) FROM DominationActions WHERE status='sent'` | ✅ 30min sweep `sent→expired` in `deleteExpiredContent` (3d) + "fizzled/skipped" chips explaining the zero-refund and a note in the camera modal. |

Admin (privacy refactor, same week): bulk DM reading and referrer analytics
REMOVED from the software; disclosure is now report-scoped
(`GET /api/admin/cases/:id`, the round-1 line "(e) key-disclosure future
phase" becomes implemented reality). Full ledger in `docs/ADMIN-SUITE.md`.

## Round 4 (2026-09-11, wave 2 / branch security/wave2-ip-masks)

| # | Sev | Finding | Repro | Status |
|---|-----|---------|-------|--------|
| F20 | HIGH | Multipart uploads stored **raw bytes**: the EXIF stripper only ran on the external-URL proxy path (`proxy.ts`), a phone photo with GPS went straight in via `POST /api/objects`. | `git log -S stripImageMetadata -- apps/api/src/routes/objects.ts` (before: absent) | ✅ shared `metadata-strip.ts` (JPEG APP1-15+COM, PNG tEXt/eXIf/iTXt/zTXt/tIME/iCCP, GIF app/comment extensions, WebP EXIF/XMP/ICCP) applied on ingress (upload, `data:` pfp) and egress (proxy already covered); dedup hash computed over clean bytes. Tests `metadata-strip.test.ts`, `metadata-ingress.test.ts`. |
| F21 | MEDIUM | Delivery token = `blake3(pubkey)` **static**: the courier could correlate every box ever addressed to you, forever. | `packages/protocol/src/mail.ts` (historical) | ✅ per-boot rotation (`sessionDeliveryToken = blake3(pubkey‖epoch)`); the epoch travels sealed inside dm/ack bodies; the home box stays a one-boot fallback. The courier schema is untouched. Tests `mail-store.test.ts` (ack with epoch), `handleRotation.test.ts`. |
| F22 | HIGH | Admin = **whoever knew the PIN last** (`verify-pin` flipped `is_admin` universally); with no identity binding, a leaked PIN = admin of any node. | historical `admin.ts`: UPDATE Users SET is_admin=0 → grant to caller | ✅ `ADMIN_ORBIT_ID` (when configured, identity check BEFORE the PIN compare, same 401 + lockout); 12h grant TTL (`admin_grant_at` in SystemMeta, enforced by `adminAuth`); guard sweep over EVERY admin route (`admin-guard.test.ts`); `pinFails` map cap (10k). Self-host nodes keep the host-is-admin model (documented in F5). |
| F23 | MEDIUM | Identity headers (`X-Orbit-Id`, signature) on **GETs** traveled in plaintext, a network observer knew WHO fetched what. | historical `api.ts`: `if (method !== 'GET' && ...)` on the seal | ✅ GETs seal their headers (empty body; `API_SEALED_ONLY` now covers GET, the flip is a release-time step, client first). Query strings audited: no parameter carries identity. Tests `unseal.test.ts`, `api.seal.test.ts`. |
| F24 | LOW | `GET /users/:id/pfp` issued a **302 to an external host** when the avatar was a URL, leaking the viewer's IP to a third party. | historical `routes/users.ts:47` | ✅ new writes no longer accept raw URLs: `http(s)` goes through `proxyAndStoreExternal` (failure → 400), `data:` is stripped; the 302 remains only for legacy rows. |
| F25 | LOW | The rate limiter kept **raw IPs as in-memory map keys**. | historical `rate-limit.ts` `getClientIp` | ✅ key = `sha256(boot-salt‖IP)[0:16]`; `security-greps.sh` proves no other module reads XFF/X-Real-IP. |

## What we did NOT solve (honest)

- **TCP-layer IP**: the network edge (fly.io; Cloudflare once the official
  node is proxied) still sees client IPs, code cannot fix that. What the code
  guarantees: the application layer never stores, echoes, logs or renders an
  IP (F25/B3/B4; `scripts/security-greps.sh` is the gate). Pending ops step:
  front the official node behind a reverse proxy (CF Proxied).
- **Traffic×time correlation** on the courier remains possible (padding/jitter
  only; without onion-routing it cannot reach zero, round 1 already said so).
- **Video metadata** (mp4/webm) is not stripped (pure-JS parser limit; upgrade
  path: ffmpeg-sidecar if ever demanded).
- The `location` field on posts is author-typed text (content, not file
  metadata), the app never fills it automatically.
- The pentest remains **static + local tests**: it does not replace a
  third-party dynamic audit.
- `API_SEALED_ONLY` covering GET is only flipped AFTER the seal-GET client
  release is distributed (support kill-switch, same policy as round 2).

## Runtime gate (wave 2)

```bash
bash scripts/security-greps.sh          # expected: ALL GREPS CLEAN
# admin without allowlisted identity: ADMIN_ORBIT_ID unset → host-is-admin model (self-host)
# expired grant: GET /api/admin/dashboard → 403 "Admin grant expired" after 12h
# legacy pfp: an old row with http:// still 302s (accepted, documented in F24)
```
