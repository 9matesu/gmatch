# Changelog

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
- Known limitations: off-mesh reachability still rides hosted rendezvous;
  no peer-address exchange; symmetric NAT needs relay; `/register` stays
  client-claimed; rooms lack forward secrecy. Full list in `P2P.md`/`SECURITY.md`.
- `site/release.json` still points at the 1.5.3 artifact until a 1.5.5 build
  is cut (see `MIGRATION.md` §2).
