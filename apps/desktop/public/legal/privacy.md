# Privacy Policy (LGPD/GDPR)

_Binding text (EN)_: **2026-11-07.1** · updated: 2026-11-07
Jurisdiction: LGPD (Lei 13.709/2018); GDPR for EU users

## 1. Who is the controller

This project runs NO data service: the download page is static and stores nothing, and no node is hosted by the maintainers. The controller is therefore whoever runs the node you are connected to. By default that is YOU (the app runs your own node): you are the controller of your own data. If you join a node somebody else runs, that operator is the controller of what its node holds, reachable through its own abuse channel; the software only implements what the host runs.

## 2. Legal bases

Contract performance (delivering the service you asked for) + legitimate interest (security/anti-abuse) + consent (accepting the Terms and enabling optional features such as uploads).

## 3. What we do NOT collect (minimisation statement)

- No content: the node you are connected to receives only sealed envelopes (XChaCha20-Poly1305) and the delivery address = BLAKE3 hash of your public key. It cannot know who sent, what, or when you read. This project holds no key and no envelope at all.

- No presence at the project: nothing here knows who is online. Your node sees the clients connected to it, because it has to relay for them.

- No IP at the project: there is no project service to see one. The node you are connected to sees your IP address, as any network peer does; server logs record redacted IPs (last octet removed); the rate limiter keys buckets on a salted one-way hash, never the address itself; the app never displays a raw server address (masked as 203.0.•••.•••).

- No telemetry: the application makes zero analytics, crash-report or beacon requests to third parties.

- No cookies: the desktop software uses no cookies and no trackers.

- Nothing on your disk beyond the session: images live ONLY in memory (RAM cache, gone at exit); keys and history are encrypted by the Windows DPAPI; content HTTP responses use Cache-Control: no-store.

## 4. What IS processed, and by whom

- **Your node (or the node you joined):** delivery address (hash), envelope size, timestamps, TTL/per-box caps (anti-flood). Purpose: routing. Retention: until expiry or immediately after a signed ack.

- **Your machine:** the full identity, keys, threads, rooms, settings, game save. It never leaves to the site.

- **Full-node (if you use one):** it stores posts, profiles, legacy DMs (encrypted with the SERVER key, so the host can read them), economies and admin logs. Check your host's policy.

## 5. Data subject rights (art. 18 LGPD / arts. 15-22 GDPR)

Confirmation, access, rectification, portability, deletion and consent withdrawal are exercised LOCALLY: export your identity in the app (portability) and delete it (deletion on your device); on a node you run, envelopes expire by themselves. This project holds nothing, so there is nothing for us to hand over or erase. For a node run by somebody else, contact that operator.

## 6. Security

Ed25519 signatures on every mutation with anti-replay nonces; ECIES (X25519 + XChaCha20-Poly1305 + BLAKE3 KDF); short-lived HMAC TURN credentials; shape-only validation without content reads; strict CSP; ICE candidate sanitisation against IP leaks (mDNS/relay). The full audit is published at legal/security.html on the official site.

## 7. International transfers and subprocessors

The download page may be hosted on cloud outside Brazil; it stores nothing and sets no cookie. The node you connect to may be anywhere, including another country: the only data it holds about you is what routing needs (delivery address, envelope size, timestamps). Self-hosted TURN is optional; we never use third-party clouds for content.

## 8. Minors

The service is for adults (18+). We do not intentionally collect minors' data; there is no age verification.

## 9. Changes

Substantial changes require fresh in-app acceptance. Current version: above and in the Legal Center screen.
