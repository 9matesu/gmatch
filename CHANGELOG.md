# Changelog

## 1.6.7 - local media is found again; missing media stops spinning

- **The vault answers by object id, not just by the old URL.** The media vault
  was written under the node URL that served each file
  (`https://<old-node>/api/objects/<id>`). After moving the world, a post row
  knows only its id, so the lookup reported "no local bytes" while the file sat
  on disk, and the tile waited for a seeder forever. `entryFor` now also matches
  any stored key that ends in `/api/objects/<id>`; the renderer probes the vault
  by object id (and by content hash for P2P rows) before it asks the node or a
  peer.
- **Missing media is terminal, and honest.** A failed resolution no longer
  leaves "waiting for poster" on screen: the vault has no bytes, the node keeps
  no media and the bounded swarm ask timed out, so the tile reports a miss.
  Posts with missing media are hidden from the timeline behind one line -
  `N posts hidden - media not on this device` with Show/Hide - instead of a
  tile that loads forever. Show remounts the tiles for one explicit retry.

## 1.6.6 — old worlds actually upgrade; dead libp2p slice removed

- **A post never disappears because its media is unreachable.** The feed used to
  hide a whole post when its tile failed to load, so a user's own old upload
  vanished whenever no seeder held the bytes. The post (caption, likes, actions)
  now stays on the timeline and only the tile shows the placeholder.
- **One empty state, no status noise.** The duplicate "Empty feed" pill above
  the timeline and the "Reading from <node> · N posts" line are gone; the single
  empty card explains the situation. Settings → Server no longer warns about a
  paused/older saved node — hosting locally is the normal state, and nothing was
  ever deleted (the media vault is untouched by the P2P switch).

- **An old database no longer bricks the node.** `migrate()` applied `schema.sql`
  before the versioned migrations, so on a database created before migration
  053 the `CREATE INDEX ... ON Objects (is_avatar)` statement threw
  `no such column: is_avatar` and aborted the whole boot — migrations 052-057
  never ran and host mode died with "gMatch could not keep its bundled server
  running" (the dev world, already at v62, was unaffected). Schema statements
  that name a column a migration provides are now deferred and retried after
  the migrations; regression test drops the column from a current DB and
  re-runs `migrate()`. Proven against the real packaged profile database
  (user_version 51 → 57 with `is_avatar` + its index).
- **libp2p slice retired** (ADR-2026-10-28-01). `electron/p2p-{host,node,protocol}.mjs`,
  the `p2p:*` IPC bridge, `useP2PNode`/`p2pBridge`, the protocol
  `peer-binding`/`blockstore`/`p2p-node` modules and the eight libp2p
  dependencies are gone: they were never wired to a renderer path and could not
  run in a packaged build (`files` excludes `node_modules`). The production
  transport remains the WebRTC mesh + sealed relay, proven by
  `scripts/p2p-two-process.mjs`.
- **Docs rebuilt around the shipped system:** `docs/P2P.md` is now the current
  map (discovery, signaling, transport phases, swarm-v1, DMs/rooms, durability,
  honest boundaries, executed evidence); `docs/NET.md` is marked retired;
  ADR-2026-10-25-01 is amended to the provenance rule 1.6.5 actually implements.

## 1.6.5 — Cloudflare rendezvous, no hosted world

- **No hosted full node.** The old hosted courier and full node are gone from
  the code, tests, docs and release page. A packaged install runs its own node;
  peers meet through a node code or the public directory.
- **The bundled node actually starts again.** `apiSidecar.cjs` referenced two
  identifiers it never defined (`injectingPin`, `fs`), so since
  `fix(admin): the passcode in .env.local was being silently overridden`
  (2026-09-29) every packaged host-mode launch threw a ReferenceError *before*
  spawning the bundled server. Behind that, `migrate.ts` resolved `schema.sql`
  one level above the running file — true for `apps/api/src/migrate.ts`, false
  for the single-file `apps/api/serve.js` that `stage-api.cjs` ships — so a
  packaged node that did spawn died at startup with ENOENT (HTTP 500/503 and no
  tables). Both fixed and covered: `electron/apiSidecar.test.cjs` drives a real
  spawn, and `apiRootFor` is tested against both layouts. `no-undef` is now an
  error for `electron/**`/`scripts/**` in eslint (it was off, which is how the
  ReferenceErrors shipped). The window opened over an empty world while the
  local database sat there intact — and host mode has been the default since
  2026-10-21.
- `https://gmatch.pages.dev` is now the release page **and** the rendezvous:
  a Cloudflare Pages Function (`site/functions/api/[[path]].ts`) serves a
  signed public-node directory and a sealed-mail relay backed by D1. It keeps
  no content tables, no accounts, no presence and no TURN, and answers 404 on
  every stateful route.
- The directory default is that courier (`DEFAULT_CENTRAL_URL`), so sealed mail
  (DMs and signalling) still reaches peers on other worlds. It has no
  WebSocket, so `MailClient` polls every 20 s when the mail base is the courier.
- Servers no longer lists a built-in world: the list is this machine's node
  plus the nodes the directory knows. The legacy Fly backfill feature, its UI
  and `probe-public-world.mjs` were deleted.
- `npm run dev` boots a local Bun sidecar and talks to it only (no remote
  mode); the dev port stays strict (`5173`). Local storage, IndexedDB and the
  identity are origin-bound, so a silent fallback to `5174` made a returning
  user's posts and keys look deleted.
- The page is now a three-column release page: section index, main content and
  a column of current-build screenshots. The copy was rewritten against
  `docs/SPEC.md` and `docs/ARCHITECTURE-P2P.md`; deprecated statements are gone
  (no "no online directory", no WebTorrent/infohash claims, and the relay is no
  longer described as the only hosted side). Screenshots are produced by
  `apps/desktop/e2e/capture.spec.ts` from the real UI over synthetic 1x1
  placeholder media, and `site/deploy-pages.mjs` stages `img/` with the page.
  In the app, the Servers empty state no longer claims there is no public
  directory, and the guide copy stops calling the old hosted node a "legacy
  server" or a "WebTorrent mesh".
- **A saved node is resolved by provenance, not by hope.** The installed app
  could boot into client mode pointed at someone else's world, so the feed
  looked empty while the local database was intact. Evidence from the field:
  the old deployment still answered `/api/health`, so a reachability-only check
  would have kept the user exactly where they were. A pointer written before
  `v2` is therefore **not dialed at all** — it is paused (kept on disk, shown as
  "an older version's server") and the launch runs the bundled node. A pointer
  this app wrote (`v2`) is health-checked once per launch and paused when it
  goes silent. `server:state` carries `pausedUrl`/`pausedReason`, explained in
  Settings → Server (Reconnect is health-probed, writes `v2`; Forget it is one
  click) and in Servers. Nothing is deleted, nothing is blacklisted by name, and
  a resolver cannot hold up the window (hard 3 s bound).
- **The renderer applies the same rule.** `clearUnreachableApiBase()` probes a
  stored non-loopback base and drops it (with the onboarding marker and dev
  proxy cookie) only when no node answers, so a stale `gmatch.api.url` cannot
  keep every surface empty.
- **No placeholder content.** The starter deck mints nothing and answers 409
  when no booru provider is configured (it used to ship five Unsplash cards);
  the hack lock screen no longer falls back to stock photos; the unused
  `BooruSlideshow`, `universalImageFeeder` (with a hardcoded API key) and the
  `/api/booru/slideshow` route with its fallback placeholders were deleted.
  `apps/api/scripts/purge-nameless-cards.ts` is gone too.

### Direct NAT traversal, silent probes

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
  short-circuits the Cloudflare courier and the loopback sidecar without a
  wire probe, and the legacy DM fetch waits for the probe — the three boot
  console errors (401 on `/api/lobby/invites`, 404 on `HEAD /api/pm`, 404 on
  `GET /api/pm?peer=`) are gone.

## 1.6.4 — release feed on Cloudflare Pages

- The project site moved to Cloudflare Pages at `https://gmatch.pages.dev`
  (GitHub Pages redirected every project page to the maintainer's personal
  domain). The updater's first feed is that manifest; the then-live public node
  stayed as the fallback (both hosts were retired in the next unreleased
  cycle). `site/DEPLOY.md` documents the deploy.
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
  world is named **gMatch Central**, the hosted courier (retired in 1.6.5) is
  infrastructure and leaves the list, and the `Legacy` status label is gone
  (ADR-002, BROWSER-PERF §10).
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
