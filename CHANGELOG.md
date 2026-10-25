# Changelog

## Unreleased — direct P2P, silent probes, gmatch Node

- Direct NAT traversal: STUN moved to Cloudflare (`stun.cloudflare.com:3478` —
  stateless, anonymous, a few packets per connection) and `srflx` reflexive
  candidates are exchanged, so peers on different NATs hole-punch into a real
  direct DataChannel instead of always falling back to the relay. Literal-IP
  `host` candidates still never leave the machine (mDNS only); TURN env still
  forces full relay for a zero-exposure posture. SPEC §10c, SECURITY.md and
  README updated to the same posture.
- The node-capability probe (`/api/lobby/invites`) is signed when an identity
  is available: a full node answers 200 and the browser console stays clean
  (the unsigned probe logged a 401 on every boot). Mail-mode detection
  short-circuits loopback/dev and known hosts without a wire probe, and the
  legacy DM fetch waits for the probe — the three boot console errors
  (401 on `/api/lobby/invites`, 404 on `HEAD /api/pm`, 404 on
  `GET /api/pm?peer=`) are gone.
- The built-in public node row is renamed **gmatch Node**; the retired Render
  courier is no longer any updater fallback (`gmatch.pages.dev` is).

## 1.6.4 — release feed on Cloudflare Pages

- The project site moved to Cloudflare Pages at `https://gmatch.pages.dev`
  (GitHub Pages redirected every project page to the maintainer's personal
  domain). The updater's first feed is that manifest; the public node stays as
  the fallback. `site/DEPLOY.md` documents the deploy.
- Removed the GitHub Pages workflow; the site artifact never carries binaries.

## 1.6.3 — public world

- Servers now offers a built-in **gmatch public** world — the full public node —
  probed live and joinable in one click, so an install with no contacts can
  reach players without knowing an address. It is a normal node, never assumed
  reachable, and the row shows offline if the probe fails.
- The Render deployment stays a directory courier (never a data base); the
  public node is no longer refused as a destination.

## Unreleased — repository hygiene

- The download page now derives its hash, size, build date and link from the
  **GitHub Release asset** (`v1.6.2`). This corrects a previously published
  SHA-256 that described a different local build; the ~100 MB binary is no
  longer tracked in Git (the Pages artifact strips it and the page links the
  Release directly).
- The development `apps/api/storage.key` is no longer tracked (`storage.key` is
  ignored at any depth) and is documented as compromised in `SECURITY.md`;
  `generateHexKey()` now uses the platform CSPRNG exclusively.
- Internal dated planning notes under `.hermes/` are no longer tracked.

## 1.6.0

- Domination: honest execution end to end — every effect now reports what
  actually happened (landed → completed / failed / declined / expired), with
  payload schemas and clamps enforced on both peers, expiry on sealed
  requests, spacing on bursts, and bounded memory. Wallpaper consent moved to
  the OS tier (`allowDesktopWallpaperOS`); native Windows toasts announce
  effects while the app is minimized.
- Domination camera: the approval prompt names who is asking (never a raw id),
  approval no longer implies success — the frame rides sealed (`dom_photo`)
  and the receipt reflects the real capture outcome.
- Domination media: video popups open as a real OS window (own process,
  frameless, closes with the effect); wallpaper/game-background images up to
  4 MB ride sealed in the request itself, so they cross peers with no shared
  server. The server ack path accepts `ok:false` and records the failure.
- Media picker: ONE shared picker everywhere — the post/story composer, the
  profile photo, the card forge and Domination effects all open the same
  dialog: Browse (your keepsakes, tag-filtered), Upload (drop, click or
  paste from the clipboard), or Paste URL (previewed and validated before it
  attaches). Persisted keepsakes resolve to the local bytes — never a
  hotlink back to the provider — and fetched media is bounded (error pages
  refused, oversized downloads abandoned mid-stream).
- Feed: the per-post sync chips ("Saved locally" / "Syncing…") are replaced
  by one quiet banner at the top of the feed showing real background sync
  state. Commenter names are clickable and open that profile; the latest
  reply still previews on the card.
- Posts: every media post carries a "Save to Vault" button (desktop) — one
  click pins the actual bytes to the encrypted local vault, deduped by
  content hash, with success/failure feedback.
- First login: the guided tour is gone; the Help guide opens exactly once
  per account, and the shell no longer fires "You are in." / "Account
  ready." toasts — the app itself is the welcome. Returning users are never
  interrupted. `?` and `Ctrl+H` still open Help anytime.
- Admin: the Admin button only appears when this machine hosts the node or
  the node says this identity administers it — no more dead navigation for
  everyone else. The PIN verify (scrypt, lockout, device-local PIN file)
  remains the real boundary.

## 1.5.6

- Servers: the browser rebuilt as one page, one list, one row per server
  (`serverKey`/`dedupeServers` dedupe by address, never by name); the official
  world is named **gMatch Central**, the onrender courier is infrastructure and
  leaves the list, and the `Legacy` status label is gone (ADR-002, BROWSER-PERF §10).
- Feed: media-first post cards (author overlay rides inside the media), absolute
  timestamps render in the viewer's own timezone, and the timeline speaks one
  body size (`text-xs`) with `text-[10px]` meta.
- Chrome: one panel colour and one opacity token (`--panel-alpha`) under every
  name, one blur scale pinned to Glass blur; `glass-toolbar` chrome stays opaque
  and the wallpaper scrim is darker so text reads over bright wallpapers.
- Clicker: the local points balance no longer renders in the stats column and
  the forced "Welcome back" offline-collection prompt is removed. Economy,
  persistence, prestige, rarity and achievements are untouched.
- Legal: the forced acceptance popup on new accounts is removed; the full legal
  documents are readable (no acceptance required) in Settings → Account &
  Security, and the age gate no longer carries a terms link.
- Likes: single-flight reconciliation (`utils/likeReconcile`) — persist once
  per gesture outside setState updaters, per-post generation discards stale
  resolutions, failures roll back, feed cache invalidated on fresh success.
  `persistLike` now throws on transport/HTTP failure instead of stranding
  optimistic state.
- Objects: `GET /api/objects/:id` no longer deletes rows with missing bytes
  (read-triggered `purgeDeadObject` removed); answers `Object bytes
  unavailable` and keeps the metadata row. Guards: posts (with/without media)
  never change the `Cards` table; only `POST /api/cards` mints.

## 1.5.5 — clean recovery release

- Recovery: new `recover/1.5.5-base` line cut from verified `v1.5.3`
  (`e7cb859`); the 108-commit `perf/feed-latency-and-providers` branch is
  preserved untouched and fully inventoried in `docs/RECONSTRUCTION.md`.
- Reuse ruling: SSBC ecosystem evaluated and **rejected** (archived upstream,
  Node-only, LGPL) — see `docs/DECISIONS.md`. Target framework: **js-libp2p**
  (maintained, browser + Node + Electron-main, WebRTC-direct first,
  explicit labeled relay fallback).
- Direction locked: minimize the custom stack, remove the blind courier and
  mandatory servers, keep Fly.io an opt-in explicit fallback only.
- Docs rebuilt for the actual code: `ARCHITECTURE.md`, `P2P.md`, `SECURITY.md`,
  `MIGRATION.md`, `DECISIONS.md`, `RECONSTRUCTION.md`.
- Fixes: none claimed — the RECONSTRUCTION triage (≈100 useful rows) is the
  queued backlog; nothing is marked done until ported with tests.
- One recovery fix IS included: dropped the phantom `@import
  "shadcn/tailwind.css"` from `globals.css` (resolved only via a stray
  undeclared install; nothing consumes it). Clean-`npm ci` build was broken
  without this; now green — see `RECONSTRUCTION.md` §9–§10 for the full gate.
- Salvaged from the abandoned branch (tested, reviewed against this line):
  post timestamps (`PostTimestamp`: relative by default, absolute on
  hover/click-latch with sticky preference); the booru fetch layer (two-phase
  cheap-first rounds, mirror cooldowns, hedged attempt runner, page memory,
  pre-gated tagless lists, `red` source + disabled `rule34-org`/`utopia` rows,
  canonical post-id namespaces); the Help modal rework (tab groups, per-topic
  screenshots, auto-show once per identity). The abandoned branch's
  click-only-economy help copy was NOT carried: this line still has passive
  income, and docs must describe the code.
- Known limitations: off-mesh reachability still rides hosted rendezvous;
  no peer-address exchange; symmetric NAT needs relay; `/register` stays
  client-claimed; rooms lack forward secrecy. Full list in `P2P.md`/`SECURITY.md`.
- `site/release.json` still points at the 1.5.3 artifact until a 1.5.5 build
  is cut (see `MIGRATION.md` §2).
