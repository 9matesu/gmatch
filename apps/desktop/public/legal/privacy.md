# Privacy Policy (LGPD/GDPR)

_Binding text (EN)_: **2026-09-11.1** · updated: 2026-09-09
Jurisdiction: LGPD (Lei 13.709/2018); GDPR for EU users

## 1. Who is the controller

For the OFFICIAL SITE (blind courier + TURN): the maintainers of the 9matesu/goongrid repository, contactable via the GitHub project. For FULL-NODES: the administrator of that server is the controller of the data it holds; the software only implements what the host runs.

## 2. Legal bases

Contract performance (delivering the service you asked for) + legitimate interest (security/anti-abuse) + consent (accepting the Terms and enabling optional features such as uploads).

## 3. What we do NOT collect (minimisation statement)

- No content: the official courier receives only sealed envelopes (XChaCha20-Poly1305) and the delivery address = BLAKE3 hash of your public key. It cannot know who sent, what, or when you read.

- No presence: site mode exposes nothing about who is online, the social graph, profiles or posts.

- No IP: TURN credential requests use an ephemeral random identity per session; server logs record redacted IPs (last octet removed); the rate limiter keys buckets on a salted one-way hash, never the address itself; the app never displays a raw server address (masked as 203.0.•••.•••).

- No telemetry: the application makes zero analytics, crash-report or beacon requests to third parties.

- No cookies: the desktop software uses no cookies and no trackers.

- Nothing on your disk beyond the session: images live ONLY in memory (RAM cache, gone at exit); keys and history are encrypted by the Windows DPAPI; content HTTP responses use Cache-Control: no-store.

## 4. What IS processed, and by whom

- **Official site:** delivery address (hash), envelope size, timestamps, TTL/per-box caps (anti-flood). Purpose: routing. Retention: up to 7 days (expiry) or immediately after a signed ack.

- **Your machine:** the full identity, keys, threads, rooms, settings, game save. It never leaves to the site.

- **Full-node (if you use one):** it stores posts, profiles, legacy DMs (encrypted with the SERVER key — the host can read them), economies and admin logs. Check your host's policy.

## 5. Data subject rights (art. 18 LGPD / arts. 15-22 GDPR)

Confirmation, access, rectification, portability, deletion and consent withdrawal are exercised LOCALLY: export your identity in the app (portability) and delete it (deletion on your device); in courier mode envelopes expire by themselves. For the official site, since data is only hashes and sealed bytes, it cannot be linked to you — deletion is baked into the architecture. For full-nodes, contact the host administrator.

## 6. Security

Ed25519 signatures on every mutation with anti-replay nonces; ECIES (X25519 + XChaCha20-Poly1305 + BLAKE3 KDF); short-lived HMAC TURN credentials; shape-only validation without content reads; strict CSP; ICE candidate sanitisation against IP leaks (mDNS/relay). Full public audit at docs/SECURITY-AUDIT.md in the repository.

## 7. International transfers and subprocessors

The official site may be hosted on cloud outside Brazil; the only data processed there are opaque envelopes and hashes, without any decryption key. Self-hosted TURN is optional; we never use third-party clouds for content.

## 8. Minors

The service is for adults (18+). We do not intentionally collect minors' data; there is no age verification.

## 9. Changes

Substantial changes require fresh in-app acceptance. Current version: above and in the Legal Center screen.
