# Changelog

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
