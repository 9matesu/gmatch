# Changelog

## Unreleased — the requests that were coded but never worked

Every item below was requested, was already "implemented" in some form, and
did not actually work in the running app. Each one is now built, tested and
verified live.

- **A post made while a friend is online actually reaches them.** The outbound
  operation wave ran only on boot and on peer-online, so a `post.create` (or a
  like, comment, edit, delete) appended while a peer was already connected sat
  `committed` in the durable log until one of the two reconnected — you could
  post in front of someone who never saw it, and the media was irrelevant
  because the metadata never left the machine. The log already announces every
  write, so `services/socialOpBroadcast.ts` now listens and hands the new entry
  to the swarm immediately, coalescing a burst into one wave. The wave selects
  only entries never handed out: broadcasting advances an entry to `sending`
  and writes, and every write announces again, so a wider selection would
  re-send on its own announcement forever (boot/peer-online waves keep the
  wider selection, since retrying a stuck entry is what they are for). Delivery
  is still only claimed on a peer's ACK. `e2e/post-two-peer.spec.ts` runs it on
  the production path with two independent clients: A publishes while B is
  online, B's operation log — which the node never stores — receives the signed
  `post.create`, B projects the row and pulls byte-identical media by content
  hash. With the subscriber disabled the operation never arrives.

- **A peer's post loads from the peer, not from a node.** A `post.create`
  operation carries the sha256 of its own bytes, and nothing in the media
  ladder ever used it: the feed row knew only `/api/objects/<objectId>`. With
  the node's data routes unavailable the picture simply failed, and the one
  swarm fallback that ran asked by object id with no expected hash — so it
  could accept whatever a peer sent and could not address bytes stored under
  their content hash (the durable key). The content address now travels with
  the row (`FeedPost.content_hash`) into `utils/contentAddressedMedia.ts`,
  which tries local bytes under the object id and the content hash (each
  hash-verified), then asks the swarm for the content hash with `expectedHash`,
  then for the object-id alias with the same expectation — no `/api/objects`
  call at all. Bytes that do not hash to the address are refused, from disk or
  from a peer, and a legacy row with no content hash keeps the old ladder.
  `services/socialFeedJoin.test.ts` runs the whole path with no node: A
  publishes and seeds only the hash, B accepts the operation, projects the row
  and pulls byte-identical verified media; a peer serving other bytes is
  refused.

- **The profile's "Saved" tab reads the NODE, not the timeline.** It was fed
  by `feedPosts.filter((p) => p.is_saved)` — the 50-row timeline snapshot — so
  a post saved days ago was invisible forever. `GET /api/posts?saved=1` is now
  a dedicated, user-scoped query (`EXISTS … Saves`), and the profile loads it
  on open and after every save/un-save.
- **A deleted post stays deleted across a reload.** The tombstone set started
  EMPTY on every launch, so a post deleted yesterday came back the next
  morning. It is re-read at boot, the node is always asked (a 404 is the goal
  state, not a failure), and the cached posts snapshot is invalidated on every
  confirmed delete.
- **Clicking out of the side sheet closes it.** The overlay was a wrapper
  carrying `pointer-events-none`, so an outside click could never reach a
  handler. The click-catcher is now a SIBLING of the panel: it covers exactly
  the page area beside it and never the panel itself. The feed and the profile
  share the same `SideSheet`, so both dismiss the same way.
- **The vault no longer flickers.** The guard read a MODULE-level
  "lookup settled" set, so a URL looked up on a previous visit read as settled
  instantly and the remote frame painted before the local copy landed. The
  settled set is now per-mount, and `ObjectImage` runs ONE lookup driving both
  the URL and the reveal gate (two independent lookups could resolve out of
  order and open the gate on the remote src).
- **The tag browser's viewer actually plays the clip.** The grid tile played;
  the VIEWER modal was `muted={false}` with no `preload`, so Chromium refused
  to autoplay it and opening a clip showed a black, paused first frame. The
  viewer is muted + `preload="auto"` + `controls`, and both videos resolve
  their URL through `redgifsPlayable()`.
- **Banning a tag is DURABLE — it lands in `blocklist.json`.** The renderer
  used to send its own stale full list, silently clobbering whatever main had
  written. The main process now owns the file (read-modify-write on the
  authoritative list) and the renderer sends only the TERMS. The durable write
  is primary: the 100-cap runtime exclude list can no longer veto a ban, a
  failed write is reported instead of swallowed, and the player's excludes
  reach the provider as `-term` query negatives — so "ban yaoi" means yaoi
  never appears again.
- **The clicker's picture cache is a real cache.** Moving on used to EVICT the
  picture that had just been cached, so the cache was permanently empty, the
  viewer had nothing to show, and the BACK arrow re-downloaded the very
  picture the player had just seen. Moving on is not rejecting: the BACK arrow
  serves the last pictures from disk, and a new "Cache" viewer (in the
  clicker header) lists what the device holds and saves a tile straight to the
  gallery. The url→file map is now PERSISTED next to the bytes
  (`imgcache/index.json`), so the cache survives a restart instead of being
  write-only.
- **Post options are a RIGHT-CLICK context menu; a caption can be edited.**
  The three-dots button is gone. Right-click a post (in the timeline or in
  the detail sidepanel) and the menu opens at the cursor, clamped to the
  viewport, carrying every action the post has — like, save, save-to-vault,
  repost, share, copy link, edit, archive, delete, report. Each row is gated
  on its handler, and the menu never claims an outcome. Editing a caption is
  owner-only: a node post is edited with `PATCH /api/posts/:id`, a
  peer-replicated post with the protocol's `post.edit` operation.
- **An edited caption actually shows up.** The server had the new caption and
  the tile still showed the old one: the durable publish outbox — the render
  source for the window BEFORE the node echoes a post back — was merged ahead
  of the node's row and never deduped against the node's ids, so the stale
  local copy shadowed the edited row. The node is the authority once it
  carries the row; the outbox now yields to it, and the local copy is synced
  after an edit so the pre-echo window and a pending re-register carry the new
  text too.
- **The clicker's modals close on Escape.** The Keepsakes Gallery, the Tag
  Browser and the Picture Cache are hand-rolled shells with no key handler, so
  they could only be left with the mouse — a trap. One shared
  `useEscapeClose` hook now covers all three.
- **A closed stdout/stderr pipe no longer kills the app.** `console.log` into
  a closed pipe raises EPIPE as an async `'error'` EVENT on the stream, so the
  try/catch around the sidecar's logging could never catch it — the main
  process died with "uncaught: Error: EPIPE: broken pipe, write". The guard
  now lives on the stream itself (`electron/stdio-guard.cjs`).
- **The idle clock stops re-rendering the app every second.** `tick()` wrote
  `lastSeenAt` into the zustand store on each 1 s beat, re-rendering the whole
  idle UI for a field NOBODY reads (only `save()` serializes it, and it already
  stamps it). A tick with no cap to expire now returns without touching the
  store, so an idle app does no render work at all (`store.test.ts` pins both
  halves: zero writes when nothing expired, exactly one when a cap does).
- **The app stops burning CPU while you are NOT using it.** Measured on a
  3-hour session: renderer ~495 s CPU, main ~433 s, GPU process 878 MB RAM,
  and 70 pictures decoded to 309 megapixels (~1.2 GB of bitmaps). Four causes,
  four fixes:
  - the **watch theater stayed mounted (CSS-hidden) on every screen**, so a
    room's 250 ms sync tick and its stream `<video>` ran on the Feed, the
    Clicker and the Vault. It is now mounted only while the Watch tab is
    open — the room lives in the store, so leaving the tab is not leaving the
    room, and returning re-syncs to the live frame;
  - **grids autoplayed videos**: a tag-browser tile played its clip and every
    timeline video started decoding on its own. A tile now shows its poster
    and plays only under the pointer; a timeline video shows its first frame
    until the player presses play (the clip the player explicitly opens still
    plays by itself);
  - **every countdown owned a private 1 s timer**. `useNow` is now ONE shared
    clock for the whole app: it starts with the first subscriber, stops with
    the last, and is paused while the window is hidden;
  - **a hidden/minimized window kept compositing**. Chromium's background
    throttling is now enabled exactly while the window is hidden/minimized
    (and switched off, with an explicit repaint, before it can be seen again)
    — the global default stays as it was, because a permanently throttled
    window used to come back with a stale frame.
- **Thumbnails instead of full-size pictures — on every dense grid.** The
  grids mounted every tile at full resolution — the 309-megapixel spike above.
  Two halves, one ladder:
  - **`gmcache://` media** (the clicker's encrypted disk cache) is served as a
    ≤360px copy by the MAIN process on demand (`gmcache://thumb/<key>`,
    generated with Electron's built-in `nativeImage`, kept in a bounded RAM
    LRU). The encrypted originals stay the only durable copy.
  - **`blob:` / `vault://` / loopback-http media** (keepsakes, signed object
    fetches, gallery tiles) has no server-side resizer, so the RENDERER
    generates the small copy once (`utils/mediaThumb.ts`: one decode, resize on
    the longest edge, a bounded 48-entry LRU of small blobs, revoke-on-evict,
    in-flight dedupe and a 60 s failure TTL). A tile whose thumbnail is still
    being made paints NOTHING rather than decoding the full-size original and
    swapping a frame later; a thumbnail that FAILS drops to the full original
    (a broken thumbnail is not a broken picture). Remote `http(s)` sources are
    deliberately NOT thumbnailed — that would download the bytes twice — they
    become `gmcache://` once cached and take the native path. A runtime with no
    `createImageBitmap` (a test/embedded environment) skips the gate entirely
    and renders immediately. The grids ask for the small copy — feed tiles,
    profile posts and cards, DM attachments, market tiles, search results and
    the match cards — and the viewer/opened post/single foe still get the real
    picture. The cache viewer also mounts a bounded window (60 tiles + "Show
    more") instead of the whole cache at once.
- **ONE roster owns "who is online".** Four discovery stacks found peers — the
  node roster, the swarm `PRESENCE` frame, the `PROFILE` frame and the tracker
  mesh — and each kept its own bookkeeping, so a peer was described differently
  depending on who found it, and the tracker-mesh path had no way in at all (the
  only roster writer was a closure trapped inside the WebSocket effect). They
  now write through one store (`utils/peerRoster.ts`): one map, one merge rule
  ("an empty field never erases; a real field always wins"), one change event.
  The store owns the node-roster merge (and reports who just came online), the
  24h ghost sweep, the persistence (online peers first, so a late joiner is not
  pushed out) and the hydration (a peer we already know is never overwritten, so
  a world switch cannot replace a live peer with its stale copy). The duplicate
  peer comparator is gone — the shared one is a strict superset.
- **The torrent-style mesh actually connects, and its peers are VISIBLE.** The
  tracker path (rotating infohash → public tracker → WebRTC → signed HELLO →
  PEX) was broken in three places and looked alive the whole time, because it
  carried bytes over a DataChannel nobody could see in the roster:
  1. **the offer id never matched** — the wire carries it as 20 binary
     characters while the mesh keyed its pending offers by the 40-char hex id,
     so the tracker's answer named an offer the mesh did not know and the
     connection was silently never made;
  2. **the wire was not the reference protocol** — the tracker runs the
     reference `bittorrent-tracker` protocol, and our announce deviated from it
     in four ways that all fail silently (the tracker simply never answers):
     the SDP travels as an OBJECT (`{type,sdp}`), never base64 and never a JSON
     string; an inbound offer/answer arrives SINGULAR (`offer` / `answer`),
     never as an array; an answer MUST carry `to_peer_id` (the server parser
     throws without it and drops the message, so the peer that offered never
     hears back); and the tracker peer id must be stable for the session — a
     fresh id per announce made the tracker see a new peer every time, so the
     answer to our own offer could not be routed back to us. The answer rides
     its own announce and goes back through the socket that delivered the
     offer. (The tracker ignores the `numwant` we send: it derives the peer
     count from the number of offers we publish — publishing an offer is what
     gets us peers.)
  3. **a verified peer had no way into the roster** — the signed HELLO proved
     the peer's key, and the peer was still invisible. The mesh now reports the
     peer and the roster admits it, with the same trust as a peer the node
     listed. A peer with no proven key is not shown.
- **No Cloudflare dependency is left.** The blind rendezvous that gmatch 2.1 put
  on Cloudflare Pages — a KV-backed mailbox + directory in `site/functions/` —
  is deleted, and the page is static again (CDN-cached, zero cost at any
  population). What that changes:
  - **`central.url` has no default.** It used to point at that origin. The node
    you are connected to IS the directory and the sealed-mail relay; a shared
    hub is opt-in (`gmatch.central.url` / `VITE_CENTRAL_URL`) and points at a
    node you run.
  - **A stored `*.gmatch.pages.dev` pointer is DROPPED, never dialed**
    (`isRetiredRendezvous` in `utils/central.ts`), stored or from the env.
  - **`isKnownSiteCourier` is gone.** It claimed a courier that no longer exists
    and short-circuited the mail-mode probe for that host. `MailClient` opens
    one watch socket per mailbox base and falls back to polling a box only after
    a socket dies **twice without ever opening** — a proxy that drops the
    upgrade, not a node that went away. `deploy-pages.mjs` ships no function, no
    `wrangler.toml` and no KV binding, and refuses to run if `site/functions/`
    comes back.
  - **The updater asks the GitHub Release, and its digest parses.** GitHub
    serves `"digest":"sha256:<hex>"` (COLON) and the parser only accepted
    `sha256-<hex>` (DASH), so every real asset hash read as `null` and every
    update was refused as unverified — it could never have installed anything.
    Both forms are accepted now.
  - **The site manifest is honest again.** `release.json` described a build that
    was never published (different hash AND size from the GitHub asset), so a
    download verification would fail. The manifest and the page's hash blocks
    were regenerated from the published bytes, and `site/check.mjs` passes.
- **No more `<button>` inside a `<button>`.** The clicker's owned-tag pill
  wrapped its delete control in the tag button, and the Store's market tile
  wrapped the seller's profile link in the view-card button. Both are invalid
  HTML, so React logged a hydration error on boot — which the E2E network
  guard correctly treated as a failure. Both now use real SIBLING buttons
  (`ShopPanel.tsx`, `StoreTab.tsx`), pinned by tests that assert
  `button button` finds nothing and by the live-clicker E2E assertion.
  The guard also stopped counting a DOWN third-party WebSocket (a public
  WebRTC tracker) as an app failure, which is the same rule it already applied
  to down booru mirrors and P2P peers; the node's own `/api/...` socket still
  surfaces.

## Unreleased — gmatch 2.0: no hosted service; the own node is the world

- **Nothing hosted is contacted.** The client defaults to `central = none`
  (`apps/desktop/src/utils/central.ts`): the node you are connected to is the
  directory, the sealed-mail relay and the swarm rendezvous. A shared hub is
  opt-in (`gmatch.central.url` / `VITE_CENTRAL_URL`) and points at a node you
  run. A pointer to the retired `*.gmatch.pages.dev` rendezvous is dropped
  instead of dialed, so an old install cannot keep talking to a service that no
  longer exists.
- **The hosted courier is gone.** The Cloudflare Pages function and its D1
  (`Mail` + `ServerDirectory` rows) were removed; the D1 was emptied and then
  deleted. `gmatch.pages.dev` is a static release page again: no function, no
  database, no mailbox, no listing. `/api/*` on that origin returns the page,
  never courier JSON.
- **All local data was wiped.** Local node DB + blob store, the Electron
  `userData` tree, browser storage, the e2e scratch directory and the scratch
  identity were cleared. The app now starts from an empty world — which is the
  honest starting point for a system with no hosted data node.
- **The legal corpus says what is true.** Terms, privacy, community, abuse,
  records and the E2E disclaimer now name the node you run (or the node you
  joined) as the controller, instead of an official hosted courier. Version
  `2026-11-07.1`; every account re-accepts once.
- **The site stops claiming a directory.** `site/index.html` and the legal
  pages describe the gmatch 2.0 topology: a download page that stores nothing,
  and a client that talks to its own node.

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
