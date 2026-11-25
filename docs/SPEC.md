# gmatch — Product Spec

One Electron desktop app, one multiplayer game. The **gmatch shell** (feed,
card duels, chat, P2P, hacks, moderation, admin — vendored from the orbit repo
in the 2026-09 merge) wraps the **Babecock · Idle** game (ex-GoonGrid): click
pictures to earn **pts**, buy **tags** (parsed live from booru sources) that
reshape the feed you are shown, buy images into your
**Gallery**, pop **GoonCaps**, climb the **Pornification** ladder, and
**Brainmelt** (prestige). Idle pts are a local-only currency (the save file);
the server g$ ledger (`EconomyService`) backs duels, hacks and trades — two
separate economies, no bridge between them.

## 0. Architecture (merge plan D1–D9)

- npm workspaces: `apps/desktop` (Vite + React 19 + Tailwind 4 renderer,
  Electron 33 shell), `apps/api` (Orbit Hono API, vendored), `packages/{crypto,
  protocol,shared}` (vendored verbatim).
- The API runs as a **local Bun sidecar** spawned by Electron main
  (`apps/desktop/electron/apiSidecar.cjs`): port 8790, SQLite snapshot + blob
  store under `userData`. Renderer base: `window.__API_BASE__` (preload) or
  `VITE_API_URL`. Identity = client Ed25519 keypair (`@orbit/crypto`); every
  request signed (`orbitFetch`). The sidecar is **supervised**
  (`electron/sidecarSupervision.cjs`): a crash OR a failed 45s health probe
  restarts it with capped exponential backoff. The old handler restarted once
  ever, so a sidecar that died while the app sat idle was never brought back and
  the profile read empty. A restart now requires N **consecutive** failed health
  probes (debounce), resets its budget on every healthy probe, and **stops the
  old process before restarting** — an early version required `db_ready` on a
  single probe and killed a healthy-but-busy sidecar under load, which then died
  on `EADDRINUSE` (the exact symptom it was meant to fix). `ping` only needs an
  HTTP 200; `db_ready` is a boot detail, not liveness.
- UI authority: Orbit's retro-glass Tailwind design system (shell). The idle
  game renders inside the shell's `grid` view, restyled to Tailwind 4 with
  shared recipes in `src/ui/styles.ts` (legacy goongrid.css deleted; only
  keyframes remain in `src/ui/grid-animations.css`).
- Single 18+ gate: the shell's `AgeGateModal` (mirrored into the idle store).
  Single onboarding: `firstRun/OnboardingFlow` includes the feed-tune step
  (pick exactly 4 starter tags + excludes). Excludes editor lives in the
  settings modal's Feed tab.
- Feed entry (1.6.8): the timeline opens with an inline composer strip (avatar
  + "Share something…" + Post) wired to the same Create Post modal — one click
  to write, no scroll. The shipping default is a 2-column grid; installs still
  on the old `'1'` default migrate once (`gmatch.feed_cols_migrated.v1`) and the
  column picker owns the choice afterwards.
- Single media picker (2026-10-18): every media entry point (create post /
  story, profile photo, card forge, Domination wallpaper/game_bg/popup_video)
  opens the shared `MediaPickerModal` (`src/components/media/`) — Browse
  (idle keepsakes, tag-filterable), Upload (drop/paste), URL (preview +
  validate). Contract in `picker.ts` (`MediaSelection`, `selectionToFile`):
  keepsake/loopback URLs are fetched to real Files before upload, popup_video
  stays URL-only (a local File has no URL a remote peer could open).
- One booru client: the idle feed fetches in the Electron main via IPC
  (`apps/desktop/src/services/booru.ts`, SPEC §6). The social feed never asks a
  booru for media — peer uploads travel over the swarm
  (`docs/ARCHITECTURE-P2P.md`).
- Content-addressed media (1.6.8): imported posts may carry `urn:sha256:<uuid>`
  or `magnet:` in `content_url`. `resolveMediaUrl` maps the URN to
  `/api/objects/<uuid>` (the node's local copy) and refuses magnet links instead
  of firing a doomed HTTP request; the API serializer falls back to
  `/api/objects/<id>` whenever `content_url` is not `http(s)`.
- Node-held P2P bytes (1.6.8): a `urn:`/`magnet:` row normally returns a `p2p`
  descriptor so the client resolves bytes from its local store/swarm. When THIS
  node physically holds the blob (imported vault, replica, repaired upload),
  `GET /api/objects/:id` serves the bytes instead of the descriptor — a preview
  the node can stream beats a swarm lookup that can only fail. Rows with no
  bytes anywhere still return the descriptor, honestly.
- A row is never dropped for missing bytes (1.6.8): the tile shows "No preview"
  while the post keeps its author, caption and counts. Hiding the row would
  erase a real post just because this device does not hold its media.
- A descriptor is never an object id (2026-11-06): the media ladder (encrypted
  vault → local swarm store → signed `GET /api/objects/:id` → swarm peers)
  requests an id only when it is a single path segment. `magnet:?…` and
  `urn:sha256:…` are DESCRIPTORS — the raw form fails locally, with no
  request at all, so a doomed call can never 404, fire `orbit-object-404` or
  poison the media LRU. The id INSIDE a descriptor stays addressable:
  `urn:sha256:<uuid>` and `urn:sha256:<sha256-hex>` resolve to that canonical
  object id (the node's local copy). A descriptor with no id at all (a bare
  `magnet:`) has nothing to request, so the tile says "No preview" instead of
  spinning on "Loading media..." forever.
- Legacy nodes still hold the bytes 1.4.0 uploaded (2026-11-06): the old
  media path wrote file bytes into `Objects.data`, so `GET /api/objects/:id`
  streamed a peer's image straight from the node. Measured on the retired
  hosted deployment: of the 200 latest posts, 188 answer with a `p2p`
  descriptor and only 12 still hold bytes (all legacy `video/mp4`, dated
  22–25 Sep and 25 Oct 2026). Posts published after the P2P alignment carry a
  descriptor only, so "a peer's image" now means "a peer who still holds the
  bytes must be online" — by design (§10d), not a regression.
- Excluded from the merge (documented, not silently dropped): `apps/discord`
  bridge, the old hosted infrastructure, Rust `image-processor` (unused).

## 1. Core loop

1. An image fills the center "Goon Panel" (fetched from a booru by owned tags).
2. Click it → +clickPower pts, splat animation, +XP. Every 25th click is a
   **CRIT** ("cumshot flash") worth x10.
3. Spend pts in the Tag Market / Image Shop / GoonCap Vending Machine.
4. Owned tags bias which images appear, and decide what the market offers.
5. Reach Pornification tier thresholds → new titles, UI accents, unlocks.
6. Brainmelt (prestige) resets pts/tags for Corruption shards (+10% global mult each).
7. **Heat combo**: clicks within 2s of each other stack a streak; every 10
   clicks adds +0.25x click power (cap x3). Idling past the window resets it.
   Session-only streak; the best streak ever persists (`maxHeatStreak`) and
   unlocks the Heat Demon achievement (80). Float texts show `+N xM`.

## 2. Currencies

- **pts** — the idle game's currency, LOCAL ONLY (2026-09-11 simplification):
  earned by clicks alone (no passive, no offline), spent in the Tag Market / Image Shop /
  GoonCap Vending Machine. Lives in the localStorage save; never synced to the
  server. The old `idle-credit`/`idle-debit` ledger bridge (plan D4) was
  removed with `economy-idle.ts`, `walletBridge` and `walletSync`.
  Legacy saves migrate `gp`/`gc`/`totalEarnedGP`/`totalEarnedGc` →
  `points`/`totalEarned` (same value, renamed).
- **g$** — the server ledger currency (`EconomyService` is authoritative):
  duel stakes, hacks, trades, store purchases. Idle no longer feeds it; you
  earn g$ through the shell's social/game loops only.
- **XP** — drives Pornification tier (never resets within a run).
- **Corruption shards** — prestige currency, persists through Brainmelt.

## 3. Tags (the "appliances" market)

- On boot the client fetches ~60 posts from a random healthy source, splits the
  booru `tags` field, filters blocklist (§8) + noise, ranks by frequency, and
  offers the top ~24 as purchasable tags (refresh button re-parses).
- Each tag: `cost = base * 1.15^owned`, `income` (rarity score: rarer = pricier =
  rarer in the feed), `weight` (feed bias).
  base/income derived from tag length + frequency (rarer tag = pricier = better).
- Max 20 owned levels per tag. Owned tags list = the feed query (top 5 by level).
- No hardcoded starter tags: the player picks exactly 4 on the setup screen
  (validity-gated + live-probed); the market otherwise seeds from drained foes
  (`discoverTags`), custom tags, and the Config tab.

## 4. Images & rarity (ORBIT card-valuation flavor)

- "Buy this image" button on the current image: cost = `rarityBase * 1.1^gallerySize`.
- Rarity ladder from clicks+price (ORBIT-style): Common 0-99, Copper 100-499,
  Silver 500-1499, Gold 1500-4999, Diamond 5000+.
- Owned images: +pts/s each (by rarity: 1/3/10/30/100), shown in Gallery tab,
  click any owned image in the gallery to re-feature it in the Goon Panel.
- Gallery persists through Brainmelt (the "keepsakes").

## 4b. Feed layout: single foe vs 3x3 grid

- The Goon Panel toggles 1×1 (one foe, full HP bar) and 3×3 (nine live squares).
- Every square is its own foe with its own HP bar: clicking a square damages only
  that square; a drained square joins the gallery (rarity/bonus/discovery as usual)
  and a fresh foe slides in from the queue. Broken squares drop reward-free.
- Auto-click caps batter the first square (one KO per tick at most, as in 1×1).
- Layout persists in the save; squares themselves are session-only.

## 5. GoonCaps (consumable buffs) — vending machine

| Cap | Cost | Effect |
|---|---|---|
| E-Girl Spit | 150 pts | x2 click power, permanent |
| Brain Drain | 50k pts | x10 click power, permanent |

Stacking: different caps stack; same-cap pops stack permanently (no timers, no wear).

## 6. Booru sources (main-process fetch, 10s timeout, round-robin health)

All sources are explicit-rated humans-only imageboards. Every query gets
`rating:explicit` + anti-slop negatives (`-ai_generated -furry -anthro -feral
-scalie -monochrome -greyscale -sketch -comic -manga -lineart -lowres
-worst_quality -jpeg_artifacts -watermark -censored`) appended in main.cjs.
Posts are double-gated (main.cjs + src/services/postFilter.ts): explicit only,
images + motion (jpg/png/gif/webp/mp4/webm, kind inferred at render), min
700x700, tag-fragment blocklist (AI, furry,
anthro, monochrome, sketch, comic, 3d, futa, yaoi, NTR, text overlays —
text overlays kept for caption hunts, §6).

- tbib: `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=<t>&limit=<n>&json=1` (JSON; full url = `https://tbib.org/images/<directory>/<image>`; DAPI rating field is the full word `explicit`)
- xbooru: same DAPI shape, `https://xbooru.com/...` (explicit-rated, high volume)
- paheal: `https://rule34.paheal.net/api/danbooru/find_posts?tags=<t>&limit=<n>` (XML `<tag file_url=...>`; query single tags only — combos return 0)
- redgifs: real/hardcore porn (pornstars like skylar vox, BBC, mp4s/gifs) via the public v2 API — temp token (`GET /v2/auth/temporary`, cached ~20h) → `GET /v2/gifs/search?search_text=<words>&order=trending&count=<n>&page=<1-5>` with `Authorization: Bearer`; posts are `kind: video` with poster stills, min 700px enforced in the desktop app
- imhentai: hentai galleries (captions, hardcore doujins), no JSON API — scrape like gallery-dl: `/search/?key=<words>` → gallery IDs (`href="/gallery/<id>"`) → cover per gallery (`data-src` base + `$.parseJSON` ext map, max 3 galleries/round, dims gate only when known). Cloudflare challenges Node-TLS fetches, so the desktop app fetches these pages via Electron's Chromium net stack; plain-browser dev may 403 and falls back to offline placeholders.
- Removed on purpose: e621 (furry), safebooru (safe-only), rule34.xxx (login wall).
- Caption hunts: a query carrying `caption`/`goon_caption` keeps text-overlay tags (`speech_bubble`, `english_text`, …) that the double gate otherwise drops — same flag in main.cjs and postFilter; everything else filters identically on both sides.
- AND-combos of narrow tags return 0 often → query variant ladder: full combo →
  top-2 tags → leading tag, per source, first non-empty wins. A variant is an
  OVER-FETCH, never an answer: every returned post is gated on the FULL query
  (matchesQuery, strict AND), so a wider variant can surface extra candidates
  but never widens the result set. Both runtimes enforce this (main
  `booruSources.cjs`, renderer `services/booru.ts`); the renderer used to gate
  on the narrowed variant and so served posts that matched only a sub-tag
  (2026-11-23) — the "picture doesn't match the tags" bug.
- Browser/dev mode: direct fetch may CORS-fail → offline SVG placeholder
  (generated gradient + tag text + "OFFLINE" badge). Never crash on fetch error.
- Dedupe by post id across a session; cache last 40 urls.
- Picture + feed caching (no re-parse, no re-download). **Storage policy
  (reconciled 2026-10-15):** picture bytes persist to an ENCRYPTED disk LRU
  (`<userData>/imgcache/*.enc`, AES-256-GCM, 500MB, `electron/diskImageCache.cjs`)
  served as `gmcache://`, plus a renderer session Map in browser dev mode;
  the parsed-post FEED index stays RAM-only in the main process for 10 min
  (40 queries). The earlier "nothing persists to disk" claim was stale — the
  F1 concern is met by encryption + RAM-only feed metadata, not by avoiding
  disk. Existing `.enc` files are not deleted by this policy. `init()` still
  destroys the LEGACY on-disk caches (`<userData>/image-cache/`,
  `feed-cache.json`) and the legacy IndexedDB store (`goongrid-img`). The
  5-up/5-down window (past 5 + queue 5 + video posters, images AND videos) is
  prefetched so skip/back is instant; cache stats + Clear live in the left
  stats panel.
- **Renderer swarm RAM cache is bounded (2026-10-17):** `utils/p2pSwarm.ts`
  keeps at most 64 objects / 96MB of blob bytes in the JS heap (LRU, reads
  refresh recency). It used to be an unbounded `Map`, so every object seen
  (feed, stories, avatars, gallery, own uploads) stayed resident for the life of
  the process — the "app eats RAM" symptom. Durable bytes are unchanged (vault on
  disk / IndexedDB), so an eviction costs exactly one re-read and never data;
  boot hydration honours the same budget.
- **Descriptor rows never masquerade as media (2026-10-19).** An announcement's
  provider link lives in `source_url`, never in the `data` bytes field, and
  neither publishing nor receiving one overwrites bytes already held. Legacy rows
  that did store the URL as bytes are detected (`utils/objectDescriptor.ts`:
  strict UTF-8, ≤4KB, exactly one http(s)/`gmcache://`/`/api/objects/` URL) and
  recovered idempotently as they are read — bytes are kept, nothing is deleted or
  re-imported, and the row stops being served as media.
- **Media rehydration: put the real bytes back (2026-11-07).** A descriptor row
  keeps the post; the bytes live in the CLIENT's stores. When those stores are
  lost, the feed honestly shows "No preview" for hundreds of posts that used to
  have images. `apps/api/src/rehydrate-media.ts` (+ `rehydrate-media-cli.ts`) is
  the one place that decides whether a candidate byte run IS the bytes a row
  used to point at — and it only ever accepts an EXACT match:
  - **64-hex `content_hash`** = `sha256(bytes)` (current scheme);
  - **40-hex `content_hash`** = `sha256(bytes).slice(0, 40)` (the old
    "fake btih" era: the magnet's btih was the first 20 bytes of a SHA-256).
  Sources: the desktop's media vault, the encrypted imgcache LRU, a node's blob
  store, another node over a signed GET, and the desktop profile's Chromium
  IndexedDB external blob store (a Blink structured clone whose inline `Blob`
  is read exactly — `B` marker + LEB128 length). Recovered bytes are written
  into the node's blob store, so `GET /api/objects/:id` serves a picture
  instead of a `{"type":"p2p"}` descriptor. Nothing is matched by caption,
  size, date or "looks like the same picture".

**One booru implementation, two runtimes (2026-11).** The main process is the
authority: it fetches, filters and only then crosses IPC. The renderer keeps a
parser set for the browser/dev fallback (no bridge there) and it must not drift:
the main-process parsers are pinned by fixtures (`electron/imhentai.test.cjs`,
`booru-*.test.cjs`) and the blocklist by `blocklistParity.test.ts`. A provider
change lands in main first; the renderer copy is a dev convenience, not a second
product path.
- **Content providers, one contract (2026-11-23).** A source is a
  `ContentProvider` (`electron/providers/contentProvider.cjs`):
  `{ id, capabilities, fetch }`, where `capabilities.categories` is METADATA
  (mediaq serves both `real` and `hentai`), so a provider is never duplicated
  per category. `createFetchBooru` routes by capability and gates every result
  on the FULL query — it never learns a provider's endpoints or schema.
- **mediaq is an optional remote provider (`electron/providers/mediaq.cjs`).**
  A self-hosted REST instance (Python; NOT bundled) at `GMATCH_MEDIAQ_URL`
  (default `http://127.0.0.1:8765`). It auto-probes: when nothing answers it is
  cooled and skipped, so the app is unchanged offline and needs no configuration.
  One provider serves the `real` tier (tube sites) and the hentai/booru niche
  (nhentai, rule34, gelbooru). Feed search metrics live in
  `electron/feedMetrics.cjs` (read-only over `booru:timings`; never a UI
  surface).
- **The media suite is one-shot (2026-11-23).** A first-run modal
  (`components/mediaq/MediaqSetupModal.tsx` + `useMediaqSetup`) offers to
  install mediaq once. `electron/mediaqInstaller.cjs` downloads `uv` (a single
  binary) and runs `uv tool install --python 3.12 mediaq` — uv pulls a managed
  CPython, so Python is never bundled and nothing is installed system-wide.
  `electron/mediaqSidecar.cjs` runs it on 127.0.0.1:8765 and stops it on quit;
  IPC `mediaq:status` / `mediaq:install` / `mediaq:cancel` / `mediaq:start`
  (+ `mediaq:progress`) drive the suite. The modal shows a real progress bar
  (percent during the uv download, indeterminate during the install) with Cancel
  and "Send to background"; backgrounded, the install keeps running and its
  progress shows as a card in the notification centre (`NotificationCenter`).
  If the install is skipped or fails the app is unchanged (local sources only) —
  it never blocks boot or the feed.

### 6b. Feed/market queries (user spec: player picks, no hardcodes)

- No hardcoded/default tags anywhere: the setup screen collects exactly 4
  starter picks (owned level 1, feed-selected, free). Feed query = top-4 owned
  tags round-robin, one tag per fetch; market query = top-3 owned tags.
  Nothing owned → feed stays offline, market stays empty until setup picks,
  custom tags, or drained-foe discovery seed it.

### 6c. Custom tags (user spec: free-form search → add when valid)

- The Tags tab has a custom-tag box: input is normalized (lowercase,
  spaces/dashes → underscores, `[a-z0-9_]` only) and gated by
  `validateCustomTag` (blocklist + noise, 2–40 chars) — never the network.
- Valid + not-a-dupe tags are probed live (`fetchPosts`, limit 5); with results
  the tag joins owned at level 1, feed-selected, free. No results (or a blocked
  tag) shows the reason inline and adds nothing.
- Motion posts (`kind: video`, redgifs mp4/webm) play inline in the Goon Panel
  with the poster still; gifs stay on `<img>`. Gallery cells render `<video>`
  thumbs for video keepsakes and re-feature them with kind intact.

## 7. UI (modern dark glassy, BabecockPanel flavor)

- Single window, 3 columns: left = stats/pornification ladder, center = Goon
  Panel (big clickable image, splat FX, buy-image + caps bar), right = tabbed
  shop (Tags / Gallery / Caps / Prestige).
- Style: `bg-black` app shell, panels `bg-surface-raised`-like `rgba(255,255,255,0.04)`
  + `border-white/10` + `rounded-2xl` + `backdrop-blur`, accent hot pink→violet
  gradient, monospace numbers, floating `+pts` texts, subtle pulse on affordable items.
- Age-gate overlay on first launch (must tick "I am 18+"). NSFW blur toggle in
  header (blurs images until hover) — default ON.
- Toasts for purchases/unlocks live in the header 🔔 tab (capped at 50, no
  floating overlay spam).
- The Goon Panel scores on **press** (`pointerdown`), not release, so a click
  feels instant; the click event that follows is ignored (`detail > 0`) so one
  press scores once, and keyboard activation (`detail 0`) still scores.
- **KO novelty drops show every tag on the defeated foe (2026-11-23).** The
  drop tray under the Goon Panel lists ALL actionable tags of the image — valid,
  not already owned, not already excluded — instead of one arbitrary suggested
  tag + one anti-tag. Each tag is a pill with **+** (adopt into your feed) and
  **✕** (ban from it); acting on one removes only that tag and keeps the rest, so
  a single foe can be tuned tag by tag, and the drop disappears when its last tag
  is claimed. The choice lives in the store (`claimDropTag(id, tag)` /
  `claimDropAntiTag(id, tag)`); the panel only renders `drop.tags`.
- Publishing a post shows it immediately: the upload response (its bytes are
  already durable locally) becomes an optimistic feed tile, and the node is
  re-read through a cache-bypassing refresh until it lists the row
  (`utils/feedPublish.ts`, bounded retries). Dedupe is by post id, so the tile
  never doubles; a post the node never lists stays visible as locally durable
  instead of vanishing, and a failed upload inserts nothing (the modal reports
  the reason and stays open).
- Deleting a post reports what actually happened (2026-11-23): a post lives in
  one of three places, and the delete path distinguishes them instead of toasting
  one message for all. `deletePostOnServer` returns `deleted` (the node confirmed,
  or it was already gone — a 404 is the goal state, not a failure), `local` (the
  post never reached the node: it is an outbox row, so removing it from
  `gmatch_post_outbox_v1` IS the delete and no request is made), or `failed`
  (the node refused or was unreachable). The feed and profile toasts follow the
  result: `local` says "Post removed from this device", only `failed` shows an
  error. Before this, a local-only test post answered 404 and read as "Could not
  delete the post" for something that had actually been removed.
- **"Unknown" is not "removed" (2026-11-24).** A transport failure on a post the
  NODE serves is not proof the post is gone: `deleteOutcomeForStatus` takes
  `{ nodeBacked }` (the row appears in a node snapshot — `serverPosts` or
  `myProfilePosts`), and for such a row 503/408/425/429 now return `failed`, so
  the tile stays and the toast says so. Treating it as `local` removed it from
  the list and the next refresh brought it straight back — "can't delete
  anything". A row that is not node-backed (a local/P2P mirror) still gets its
  tombstone: there is no server row to wait for.
- **A magnet btih is a content hash, not a dead end (2026-11-25).** 39 of 50
  rows in a real feed snapshot are `magnet:?xt=urn:btih:<40-hex>` (the legacy
  "fake btih" = sha256(bytes).slice(0,40)). `objectRef` used to answer "no id"
  for every magnet, so those rows were unresolvable and showed no image even
  with the bytes on disk. Now the btih inside the descriptor IS the ref id
  (still never a node path): the vault accepts 40- or 64-hex and indexes both
  forms, IndexedDB resolves a 40-hex miss by prefix, and the tile keeps an
  honest "No preview" when no bytes exist anywhere.
- **A healthy sidecar is adopted, never re-spawned (2026-11-25).** A crash or a
  restart with `:8790` already answering is adopted (the sidecar may be one a
  previous launch left running, not our child); spawning anyway died with
  EADDRINUSE and burned the restart budget while the app was served fine.
- **Media has its own connection budget (2026-11-24).** Chromium opens six
  connections per host. Signed object streams keep the long 120s budget, and a
  profile grid used to start one per tile — all six sockets sat on media while
  every other call (feed, lobby, notifications, DELETE) queued behind them and
  died on its own 8s timeout, which read as "nothing loads and nothing deletes".
  `useObjectImage` now runs at most 3 signed object streams at once
  (`MAX_CONCURRENT_OBJECT_FETCHES`, FIFO queue); vault/IndexedDB reads stay
  unbounded because they never hold a socket. Profile grid tiles are also back to
  the default lazy load: `loading="eager"` on four grids was what started the
  storm.
- **A tile in flight is not unavailable (2026-11-24).** `ObjectImage`'s
  availability timer only fires when nothing can still arrive (an unresolvable
  descriptor, or a failed fetch) — or when the caller passed an explicit budget
  (a story must skip media that outlives it). Firing it at 6s while a signed
  fetch was still running hid `hideUnavailable` tiles mid-load: "the images
  disappeared".
- **Legacy `vault://f/<hash>` descriptors resolve to bytes (2026-11-25).**
  `persistToVault` wrote the 74-byte UTF-8 descriptor `vault://f/<hash>` into
  IndexedDB `objects.data` (with `source_url` set) so the gallery/feed could
  render from the vault stream. `hydrateLocalObjects` and `readDurableObject`
  wrapped that descriptor text in a `Blob` and minted a `blob:` URL whose bytes
  were the URL string (`naturalWidth === 0`). Both now detect the descriptor via
  `descriptorUrlFromBytes` (extended to accept `vault://`) and resolve it through
  `readVaultBlob(ref)` instead of rehydrating text as media; `ObjectImage` also
  evicts a broken `blob:` entry from the `useObjectImage` LRU on media `onError`.
- **Retired-host client config is cleared on boot (2026-11-25).** A stored
  `gmatch.api.url` / `gmatch.onboarding.serverUrl` pointing at a retired host
  (`https://gmatch.fly.dev`) and old `gmatch.feed.snapshot.v1:*` rows survived
  because `fly.dev/api/health` still answered `200`, so `flushPostOutbox`
  replicated new posts to the dead host instead of this machine's node. The rule
  is provenance, not reachability: **a host-mode launch must use THIS node**, so
  `App.tsx` drops a stored **non-loopback** `gmatch.api.url` / onboarding marker
  whenever `serverState().mode === 'host'` (a client launch keeps its pointer),
  clears a retired `gmatch.central.url` (`fly.dev`), and drops stale snapshots —
  then reloads once so `API_BASE` and the outbox target `http://127.0.0.1:8790`.
  This also covers a non-packaged run, where `server:state` returns `mode:'host'`
  with no `pausedReason`.
- **A replicated post is re-armed onto THIS node (2026-11-25).** A post marked
  `replicated` in `gmatch_post_outbox_v1` was replicated to a retired host
  (`fly.dev`) and `flushPostOutbox` skipped it forever, so it never reached the
  local node and never appeared in the timeline. On boot the flush now calls
  `rearmMissingReplicated`: each `replicated` entry is probed once
  (`GET /api/objects/:id`) and a 404 moves it back to `local` (bounded, once
  per session), so the normal flush registers it on `127.0.0.1:8790`.
- **Deleting a post deletes it on the node, ALWAYS (2026-11-25).**
  `deletePostOnServer` used to treat an outbox row that was not `replicated`
  as local-only and remove it without a node call — but the flush can have
  registered the row on the node a moment before the local state advanced, so
  the row survived and the next snapshot brought the post back ("deleted posts
  reappear"). The node is now ALWAYS asked: a `404` is the goal state (the
  post was never on a node), not a failure, so one request covers every case.
  The local outbox row is removed first so it is never registered again.
- **A deleted post stays deleted across a reload (2026-11-25).** The durable
  tombstone (`gmatch_deleted_posts_v1`) is re-read at BOOT into the tombstone
  set the feed projection filters by. It used to start EMPTY on every launch,
  so a post deleted yesterday was filtered for the rest of that session and
  came back on the profile the next morning — the server had really removed
  the row, so nothing but the client's own tombstone bookkeeping brought it
  back. `deletePostOnServer` now writes the tombstone and the live set in ONE
  place, so every delete (feed, profile, anywhere) drops the row from the
  timeline AND the profile, and the tombstone survives the next launch.
  Proven by `e2e/post-delete-durable.spec.ts` (delete → RELOAD → still gone)
  and by the API test that asserts the `Objects` row is gone and no read path
  (feed, profile query, detail) lists it.
- **A delete invalidates the cached posts snapshot (2026-11-25).** The 3s GET
  response cache still served the deleted row after the node had removed it:
  the tombstone masked it in the UI, but the next refresh re-seeded
  `serverPosts`/`myProfilePosts` from the stale snapshot with a post the node
  no longer had. Every confirmed delete now calls `invalidateCache('/api/posts')`
  in the same place the tombstone is written — one owner for "this post is
  gone" — so the next read of the posts collection goes to the node.
- **A stuck signed fetch gives up (2026-11-25).** `ObjectImage` had no ceiling
  for a signed fetch still in flight, so a request queued behind the 3-slot pool
  (dozens of old rows) could read "Loading media…" for the life of the session.
  A hard cap (`HARD_UNAVAILABLE_CAP_MS` = 30s) now applies when bytes are still
  expected; an explicit budget (a 5s story) still wins.
- **The tag browser can pin a source (2026-11-25).** A source picker (All +
  imhentai/tbib/xbooru/…) passes `source` through `fetchPosts` to the main
  `createFetchBooru`, which narrows the pool to that provider and skips the
  per-query memo — so imhentai (a slow phase-2 scraper a fast mirror would
  otherwise beat) actually answers when selected.
- **Delete logs the truth and retries a busy node (2026-11-25).**
  `deletePostOnServer` logs `status outcome nodeBacked` for every delete and
  retries once on 503/408/425/429, so a delete that "came back" is diagnosable
  from `main.log` instead of silent.
- **The tag browser trusts the main gate (2026-11-25).** The browser fetches with
  `silent:true`, and the renderer re-ran its stricter `sanitize()` on the main
  process's already-gated results — imhentai's small gallery covers were dropped,
  so the source read "offline" though it answered. The main process is the
  authority (blocklist + postFilter); the silent path now uses its posts as-is.
- **The clicker ban is a multi-select (2026-11-25).** The drop tray's ✕ toggles a
  tag into a per-drop selection and one "Ban N selected" button applies them all
  (`claimDropAntiTag` per tag), instead of banning one tag per click. The top-right
  Prohibit button no longer purges: it opens a picker of THAT image's tags
  (checkboxes + "Ban N selected" → `addUserExclude` + skip), with "Purge" kept as
  the explicit whole-image option.
- **Fewer clicks: picker opens on the gallery, post modal is 2 columns (2026-11-25).**
  `MediaPickerPanel` opens on the Browse (gallery) pane whenever it is offered, so
  a keepsake is one click away. The Create Post modal is a 2-column grid on
  `md+` (media left, caption/fields right) so the whole post fits one screen.
  The notification button is a chat-style pill in the `CommandIsland` (bell +
  unread `CountBadge`) that opens a fixed, animated **left sidebar**
  (`NotificationSidebar`) dedicated to the unified `NotificationCenter` (opened
  expanded) — not in the header.
- **The feed post opens as a side sheet (2026-11-25).** Clicking a timeline
  post opens the detail in a right `SideSheet` (media + caption + like/save/vault/
  share + comments), like opening a photo in the profile — the row no longer
  expands inline. The sheet content is padded (`pb-24`) so the bottom nav never
  covers it. The post caption sits **below** the image at a smaller size, and
  Save + Add-to-Vault are grouped on the right. The like chime (`playLike`/
  `playLikeOnce`) is deleted for good. `ObjectImage` keeps the last loaded `src`
  until a vault/cached swap loads, so opening a post no longer blinks.
- **Timeline order: media → author → caption → actions (2026-11-25).** A
  timeline card renders the **media first**, then the author row (avatar, name,
  handle, time), then the written body, then the action row. The old
  caption-under-the-image block is gone; the repost line sits with the author
  block under the media.
- **One detail sidepanel for feed and profile (2026-11-25).** Clicking a post in
  the feed opens the SAME `ProfileExpandedPost` inside the right `SideSheet` that
  the profile grid uses, so the image sidepanel is visually identical in both
  surfaces (and closes on outside click / Esc). The bespoke feed detail JSX was
  removed.
- **Vault no longer flickers on open (2026-11-25).** For an opted-in `http(s)`
  source, `ObjectImage` holds the media at `opacity:0` until the local vault
  lookup settles (a fast IPC), so a remote frame never flashes before the local
  copy swaps in; the gallery grid does the same per tile (`vaultPending` until
  the vault lookup + `vault://`→http resolution settle). A no-copy image reveals
  as soon as the lookup returns.
- **Clicker + tag-browser videos actually play (2026-11-25).** The Goon Panel
  `<video>` (single foe and grid) and the Tag Browser grid `<video>` use
  `autoPlay` + `preload="auto"` (muted, loop, playsInline) so a motion foe/clip
  animates instead of sitting on a black/poster frame.
- **Posting is universal: every post shows (2026-11-25).** The text-less hiding
  rule (a row with no words was hidden until its bytes resolved) made a fresh
  post vanish from its author's own timeline, and a descriptor post whose bytes
  were not local could never promote (its tile never mounted). Now every
  renderable row shows immediately; media with no bytes renders "No preview"
  (bounded by `ObjectImage`'s 30s cap), never a hidden row and never an endless
  spinner. The `deadPosts`/`mediaReady` probe machinery is gone.
- **A closed sidecar log pipe is not a crash (2026-11-25).** `apiSidecar.cjs`
  logged child stdout/stderr with `console.*` and no error handling, so a closed
  pipe threw an uncaught `EPIPE: broken pipe` (seen as "broken pipe" on delete).
  The log write is wrapped and the pipes swallow stream errors.
- **SQLITE_BUSY waits instead of 503 (2026-11-25).** The sidecar set WAL but no
  `busy_timeout`, so a concurrent writer (RateLimits/Users) returned
  `SQLITE_BUSY` → a 503 that made a DELETE which actually applied read as "could
  not delete" (the row vanished on the next refresh). `serve.ts` now sets
  `PRAGMA busy_timeout = 5000`.
- **Dead media rows hide and REAPPEAR when bytes arrive (2026-11-25).**
  `GMatchFeed` sets `hideUnavailable={true}` on timeline `ObjectImage`s and
  `visiblePosts` drops a row once `deadPosts` marks it, so legacy
  `magnet:`/`p2p` posts without local or online-peer bytes no longer fill the
  timeline with empty frames. The state is **reversible**: `promoteMedia` clears
  `dead` (a local read, a signed fetch, or a peer that came online with the
  bytes), and a feed-level re-check on `PEER_ONLINE_EVENT` re-promotes a hidden
  row whose bytes are now held locally — so a post that "appeared then vanished"
  comes back the moment its bytes exist. A one-way `deadPosts` set used to hide a
  post for the rest of the session even after its bytes landed.
- **The grid measures local-object posts too (2026-11-25).** `FeedGrid` only
  laid out posts whose aspect ratio was known, and the ratio probe ran for
  `^https?:` URLs only — so `vault:`/`magnet:`/`p2p`/`/api/objects` posts never
  got a ratio and the grid stayed empty ("Nothing to lay out yet"). The probe now
  also resolves a local object's bytes (`getLocalObject`) and measures the blob,
  and each `FeedTile` reports its rendered natural size (`onLoadSize`) so a tile
  that mounts can be measured; a descriptor whose bytes nobody holds stays out of
  the grid (per the visibility rule) until a peer brings them.
- **`onClick={window.gmatch.winMinimize}` no longer throws (2026-11-25).**
  Passing the `contextBridge` function directly as the React `onClick` handler
  handed React's non-cloneable `SyntheticEvent` to `ipcRenderer.send`, which
  threw `Error: An object could not be cloned.` on every window-button click.
  `NativeHeaderBar` now wraps each call in `() => window.gmatch?.winX?.()`.
- **Reading the timeline is a stated state, not a guess (2026-10-19).** The feed
  carries an explicit status (`idle|loading|ready|offline|error`), so an empty
  list says which one it is instead of implying "nothing here". The snapshot read
  is generation-guarded (a slow earlier reply can never overwrite a newer one), a
  post pushed over the socket survives an in-flight snapshot
  (`utils/feedMerge.ts`, 2 min TTL) and retires the moment the snapshot lists it,
  and the feed re-reads itself once (bounded, ≥15s apart) when a peer comes
  online. A deep link (`#/feed?post=<id>`) is keyed by id, so a second visit —
  including a hash-only navigation — re-arms instead of being consumed once, and
  a post the snapshot does not carry is fetched by one targeted signed read and
  pinned, never fabricated.
- **A tile shows the post's own count.** The like count follows the post: a tile
  first rendered from a local/P2P mirror (which carries no count) updates when the
  server row lands, instead of freezing the first value it ever saw. Only the
  user's own in-flight like outranks the post, and only until the post catches up.
- Tags tab: owned pills toggle ON/OFF plus SOLO (feed only that one tag).
  Gallery tab: text box filters keepsakes by tag substring.
  Config tab: starter picks recap + extra excludes (add/remove, 100 max).
- Keepsakes render from locally held bytes only: the Electron media vault on
  disk, or the IndexedDB object store when there is no bridge. A saved keep is
  identified by `sha256(bytes)` (`localRef`), images/videos are served over the
  vault's loopback http URL (Range-capable), and the provider URL is never used
  as a render source for a verified keep.
- Vault rows written before content hashes were recorded are keyed by source url
  (`sha256(url).<ext>` on disk). On the first lookup by content ref the main
  process reads such a row once, binds `hash = sha256(bytes)` and persists it, so
  a keep whose source url drifted still finds its own bytes.
- The keepsake viewer resolves `localRef` → source url → object store and states
  its outcome: a distinct loading state while the lookup runs, the media when it
  lands, and "Media unavailable locally" only after that lookup confirms the
  bytes are gone. Bytes that are on disk but cannot be read/decrypted are
  reported as a read failure (with the reason), never as a missing file, and the
  record is neither dropped nor re-imported while local bytes may still exist.

## 8. Blocklist — client-side only (reject tag if a term matches on a token boundary; case-insensitive)

The server NEVER hard-blocks a tag: write paths (objects, gossip, slideshows,
users) store tags verbatim and gossip replicates them as-is. Filtering happens
exclusively in the desktop client (feed queries, post tags, market discovery),
driven by a single source of truth:

`shared/blocklist.json` (factory default) + the user's edited copy at
`userData/blocklist.json` (takes precedence, written only through Settings →
Blocklist; Settings never touches the repo file).

**Matching rule.** A term matches when it occurs in the tag *aligned to a token
boundary*, where tokens are underscore-joined words (hyphens and spaces are
treated as the same boundary). A term may still be a **prefix** of its token, so
`lolicon`, `shotacon`, `teenager`, `childhood_friends`, `necrophilia` and
`zoo_philia` all stay blocked. Only a mid-token hit is ignored.

This is deliberately NOT a raw substring test. Substring matching blocked
`fifteen` (via `teen`), `scrape`/`grape` (via `rape`) and `nineteen` — 6 of 9
measured false positives on a legal-tag sample, which quietly starves the feed.
It also blocked `zoom` (`zoo`) and `babydoll` (`baby`), which survive because
prefix matching is what keeps the real compounds blocked; removing those two
would leak `zoophilia`/`baby`-prefixed terms, so they are a policy decision, not
a code one.

The rule is ONE implementation: `packages/shared/src/blocklist.ts`
(`normalizeTagText` + `hitsAtTokenStart`) — the renderer, the API and the
protocol all import it, and `isBlacklistedTag` (the shared gate behind
`normalizeTags` / `parseTags`) uses the same token-boundary rule. The
Electron main process cannot import TypeScript, so it carries the CommonJS
mirror `apps/desktop/electron/blocklistRule.cjs`; the renderer and the main
process enforce the same hard line, so the two must not drift — a parity
test (`apps/desktop/src/game/blocklistParity.test.ts`) pins them against the
same fixtures.

Player excludes (setup screen + Config tab, 100 max, persisted) extend this
list at runtime: queries, post tags, and market discovery all respect them,
using the same token-boundary rule.

`loli, shota, child, kid, infant, baby, toddler, school, student, uniform-ish
minor terms, ageplay, incest, bestiality, zoo, necro, rape, non-consent, gore,
scat, urine, blood, murder, death`. Also reject posts whose rating is not
explicit/adult. The list lives in `shared/blocklist.json` (single source of
truth; also imported by electron/main.cjs and required by src/game/tagFilter.ts)
and additionally blocks: AI-generated (`ai_generated`), furry/anthro/feral/
scalie, monochrome/greyscale/sketch/comic media, low-quality markers, and
count-tag noise (`1girl`, `solo`, `2boys`, ...). The rule is pinned by
`packages/shared/src/blocklist.test.ts` and `src/game/tagFilter.test.ts` — the
hard line is the most important tested code in the repo.

## 9. Prestige — Brainmelt

- Available at Pornification tier 5+ ("Pervert").
- Shards = floor(sqrt(totalEarned / 1e6)); each shard +10% global multiplier.
- Resets: pts, XP/tier, tags, caps. Keeps: gallery images, shards, achievements.

## 10. Achievements (small, spicy, 12 total)

First Click, 100 Clicks, First Tag, Tag Collector (10 tags), Gallery of Sins
(10 images), Diamond Hands, Crit Addict (50 crits), Cap Connoisseur (both caps on sale),
First Brainmelt, 10 Shards, Goon Master (tier 10), Heat Demon (80-click
heat streak). Each +5% click power. Persist across prestige.

## 10b. Domination economy & spy payoff (connected loops)

- Every PC-Domination action costs g$ from the authoritative ledger (one
  wallet, plan D4): wallpaper/game_bg 250, text_overlay 400, message 500,
  blur 800, popup_video 1200, camera 2500. Debit happens BEFORE the action
  is recorded/broadcast — broke dominators get 402 and nothing fires.
- The victim is paid a consent cut (40-60% of the fee, scaled by
  intrusiveness): being dominated earns you g$. Idempotency keys are the
  actionId, so retries never double-charge or double-pay.
- `GET /api/domination/prices` exposes the table; the UI shows the price on
  every action card and the payout in the success toast.
- **Spy feed is real**: `GET /api/users/hacks/spy-feed/:targetId` returns the
  target's recent public posts + intercepted DM peeks, server-gated to the
  ATTACKER of a still-active hack (403 otherwise). HackSpyView polls it every
  15s and renders actual data — no hardcoded fake logs.

## 10c. P2P transport (ICE hygiene)

- Single source of truth: `apps/desktop/src/utils/ice-hygiene.ts` (client) +
  `candidateLeaksIp` in `apps/api/src/routes/signal.ts` (server gate).
- **Direct first.** STUN is Cloudflare (`stun.cloudflare.com:3478` —
  stateless UDP, no account, a few packets per connection). Reflexive
  (`srflx`/`prflx`) candidates are exchanged, so peers on different NATs
  hole-punch into a direct DataChannel. A peer necessarily learns the
  address it connects to; Cloudflare learns nothing but an anonymous query.
- Literal-IP `host` candidates NEVER leave the machine (mDNS `.local` hosts
  only) — the LAN stays private. Unknown shapes fail closed. The signal
  server re-validates every posted candidate (defense in depth against a
  malicious peer) and 400s raw-IP `host` ones.
- TURN env (`NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL`) flips the config to
  `iceTransportPolicy: 'relay'` — fully relayed connections, zero IP
  exposure, for users who choose that posture.
- Symmetric-NAT pairs (which STUN cannot traverse) fall back to the sealed
  WS-relay swarm; the UI reports the real path.
- Wave 2 (masks): peers address each other ONLY through delivery tokens
  rendered as `gmatch://node/...` codes (`utils/nodeMask.ts`); tokens
  rotate per boot (`utils/handleRotation.ts`, epoch travels sealed inside
  dm/ack bodies). Node coordinates share as `gmatch://node/...` codes
  (`utils/nodeMask.ts`) and the directory gossips through the node you are
  on, so nodes stay reachable without the hub. Every image entering or
  leaving the app is metadata-stripped (`apps/api/src/metadata-strip.ts`);
  post tags live in the DB, never in the file.

## 10d. P2P Swarm & Blind Courier Presence (ARCHITECTURE-P2P.md)

- **Two kinds of node, one codebase** (`serve.ts` decides with `SITE_SERVICES`):
  - **Full node** (the default: every packaged install; `mode: "legacy"` in
    `/api/health`). It stores the world it serves — profiles, posts, objects,
    presence — and is the directory, the mail relay and the swarm rendezvous
    for its clients. `/api/users/online`, `/api/posts`, `/api/objects/:id` and
    `/api/signal/*` exist and answer a signed request.
  - **Courier** (`SITE_SERVICES` set: the Pages rendezvous). Blind and
    zero-knowledge: it holds only sealed envelopes and relayed swarm frames,
    and every route outside its allowlist 404s at the edge.
  The older text here ("a node holds no profiles or posts, those routes 404")
  described the COURIER only. Read as the packaged node it was false, and it
  would have argued for deleting routes that work.
- **A peer on another node is reachable:** the signed presence beacon carries the node
  URL the peer is connected to, and a sealed envelope addressed to that peer is dropped
  into THAT node's mailbox (the node still cannot open it). The client learns the other
  nodes from the directory it reads on the node it is on (SPEC §12).
- **The node URL is DIALABLE (2026-11-07).** A beacon used to name the API base, which
  is `127.0.0.1` in the packaged app (a peer would read that as its OWN loopback) and
  empty in a browser build (the dev proxy carries no address). `resolveNodeAddress`
  (`src/utils/serverAddress.ts`) asks the node for the addresses it answers on
  (`GET /api/servers/node` → `lanUrls`) and signs the LAN one into the beacon; a
  non-loopback base (a client joined to a friend's node) is already the answer. The
  client drains that SAME box: `useCourierDms` adds the node's address as a mailbox
  base when the API base hides it, so an envelope addressed to our node is read instead
  of waiting for its TTL.
- **Presence & Discovery:** Ephemeral signed beacons (`PresenceBeacon`) broadcast to public
  presence token `sha256Hex('orbit-global-presence-v1')`. Client compiles and verifies in-memory
  roster with 60s TTL and 120s drop threshold. Zero presence state stored on server.
- **Signaling over Courier:** WebRTC signaling (SDP offer/answer, ICE) sealed with X25519 ECIES
  and routed as `kind: 'signal'` envelopes via `/api/mail/:token`.
- **Swarm Media Distribution:** Media divided into 5 KiB legacy / 4 KiB sealed
  payload chunks (`SWARM_WANT`, `SWARM_CHUNK`) — the chunk size keeps the base64
  JSON frame under the relay's frame-splitting threshold — over direct WebRTC
  DataChannels (`gmatch-mesh`) or the node relay. Since swarm-v1 (2026-10-22)
  chunk transfers are end-to-end encrypted: the fetcher offers an ephemeral
  X25519 key, the seeder seals a per-transfer DEK to it, and every chunk is
  XChaCha20-Poly1305 with AAD binding object/transfer/index/fetcher; legacy
  plaintext serving is default-deny. Relay nodes therefore carry ciphertext
  they cannot read or alter. All received/created media stored in local
  IndexedDB and automatically seeded on boot (`hydrateLocalObjects`).
- **Announcements ride the relay too (2026-10-19):** peer announcements
  (`IMAGE_ANNOUNCE`, `MESSAGE`, `STORY_ANNOUNCE`, `CHAT`, `PRESENCE`) are wrapped in
  the `SWARM_FRAME` envelope, which the node relays to the global room with a
  `relayedBy` stamp carrying the identity the socket proved at auth. Sent bare they
  were refused, so a peer post was discoverable only over a direct WebRTC channel.
  Frames that merely *look* like a server event (`feed`, `user_banned`) are still
  dropped (audit A2).
- **`SWARM_HAVE` is real:** held ids are advertised (≤64, most recent first,
  throttled to 10s, fired on peer-online and after boot hydration) and answered only
  for ids this session already wants (a timed-out fetch / a failed tile), never for
  one it holds or has in flight, ≤3 at a time, each with its own timeout. A failure
  stays *wanted* for the next advertisement — an advertisement is not a mandate to
  download a library.
- **The relay carries the whole client-to-client wire (2026-11-07):** the node's
  `SWARM_FRAME` allowlist now includes `SWARM_KEY` (the per-transfer DEK sealed
  to the fetcher's ephemeral offer key), `SWARM_CHALLENGE`, `SWARM_RECEIPT`,
  `SWARM_OP` and `SWARM_OP_ACK` — each with a shape check, while anything that
  looks like a server event is still dropped (audit A2). Without `SWARM_KEY` the
  guaranteed relay fallback could never decrypt a chunk, so a peer that cannot
  punch a direct WebRTC hole received nothing but unreadable ciphertext. The
  relay never opens a payload; the receiver's authorizer decides.
- **One swarm contract, both ends (2026-11-08):** the frame shapes, the bounds
  and the relay allowlist live in `packages/protocol/src/swarm-frame.ts` — the
  package both sides already import. The node's allowlist IS that predicate
  (`isRelayableSwarmFrame`), and the client NARROWS what arrives
  (`parseSwarmEnvelope`) instead of casting it. Every inbound pipe (relay
  socket, local-tab channel, direct mesh) goes through one route
  (`routeInboundFrame`) and one announcement handler, so the two ends cannot
  disagree about what a frame is. A field of the wrong type is dropped; a
  frame that does not fit its declared shape never reaches a handler. When a
  frame came through the relay, the socket PROVED the sender (`relayedBy`): an
  announcement whose self-described user id disagrees is dropped, exactly as
  the object path already did (`resolveClaimedOwner`).
- **A transfer that cannot complete says so (2026-11-07):** assembly finishes
  only when the transfer declared a size AND every chunk index arrived. A chunk
  that fails its AEAD check is dropped and counted; once every index of the
  transfer has been seen and one never authenticated, the fetch fails with
  `failed authenticated decryption` instead of assembling an empty blob. No
  partial transfer is ever persisted.
- **Descriptor vs bytes:** `data` is media, nothing else. An announcement's link is
  stored as `source_url`; publishing or receiving one never overwrites bytes already
  held. Legacy rows that wrote the URL into `data` are recovered idempotently on read
  (nothing deleted, nothing re-imported) and render from the link. An `owner_id` that
  contradicts the proven `relayedBy` sender is stored `owner_verified: false` and
  never borrows that user's directory name or avatar.
- Full specification documented in `docs/ARCHITECTURE-P2P.md`.

## 10e. Group chat, social graph and reports as peer operations (2026-10-22)

- **Group chat rides a SEALED ROOM.** The node keeps the group (who is in it,
  who may join); the conversation does not have to live on the node. A group
  maps to a room whose id is DERIVED from the group id, so every member
  computes the same room without a lookup. The DEK cannot be derived (it is
  the secret), so it is created once and shipped inside the sealed invite:
  the first member to open the group owns it, and a second creator does NOT
  overwrite it (an equal-epoch invite merges the membership, a higher epoch —
  a leave/re-key — replaces the DEK). Every message is group-sealed and fanned
  out to the members' mailboxes; the node's rows stay as the history from
  before the room existed, and the two are merged by id. The UI says which
  transport a group is on ("sealed group chat" vs "on this node").
- **The social graph is operations.** `follow.add` / `follow.remove` are
  signed, chained operations: the removal names the author's own add
  operation, a duplicate follow is refused, and following yourself is
  refused. The node's follower counts remain the node's bookkeeping; the
  operation is the graph that travels.
- **The Followers table is the ONLY follower count** (2026-11-08). The
  denormalized `Users.followers_count` / `Users.following_count` columns are
  gone (migration 058): every follow bumped them, every cascade delete and
  account wipe left them stale, and NO public read path used them — the
  profile, the roster, `/me` and the follow endpoints all derive
  `COUNT(*) FROM Followers`. The admin panel was the one reader and the one
  writer, so an admin could set a follower count that no user would ever
  see. The count is now derived everywhere and is not adjustable.
- **Reports are operations, and there is no admin in a mesh.** A report about
  peer-replicated content is a signed `report.create` operation, so it
  reaches the AUTHOR of that content through the mesh. The author is the one
  who can act on it, and the report shows up in their notification centre
  ("X reported your post"). Node-hosted content keeps the node's moderation
  queue — the node that hosts the content moderates it.

## 10f. Card & store economy — what actually exists (2026-11-08)

Three subsystems were cut because they could never be used, not because they
were hard to build. Every surface that mentioned them was removed with them.

- **No lootboxes / packs.** The server's pack catalogue was unsellable: a
  purchase granted inventory nobody could open, and the store copy said
  "Buying retired". The `Lootboxes` table, its two migrations, the service,
  the admin routes and the `'pack'` store category are gone.
- **The store catalogue is exactly `STORE_ITEMS` from `@orbit/shared`** —
  Screen Lock, Vision Jam, Flash Drop Broadcast. The node used to overlay
  prices from `SystemMeta.store_prices`; that override is removed, so the
  shared list is the single source of truth and the client and server can
  never disagree about what a thing costs.
- **No bot opponents.** The bot provider cluster (`bot-image-api.ts`,
  `bots/`, `starter-deck.ts`, the shared booru client) fed a match system
  whose only entry point was an admin force-match route. The whole cluster is
  deleted, and a quick match now pairs humans or waits.
- **No starter cards.** A new account owns no cards. Cards come from the
  client forge (`POST /api/cards`) and the Community Market; the Help copy
  says exactly that.
- **The slideshow `'api'` source is gone.** A slideshow is a playlist of the
  caller's own cards/posts; the server fetches no media itself.
- **Attention ping.** `POST /api/users/attention` sets the CALLER's own
  30-second attention flag, which floats that player to the top of the
  roster. It is a self-ping ("I am here"), offered on your own profile only;
  there is no route that pings another player.

**Admin parity is enforced both ways** (`apps/desktop/src/admin/adminEndpointParity.test.ts`):
every admin request the client makes must exist on the server with the SAME
verb, and every admin route on the server must have a caller in the product
— otherwise it is deleted. `POST /api/admin/verify-pin` is the sole
public-by-design exception, and the gate proves structurally that it sits
above the PIN guard and that nothing else escaped.

**Writes are transactional.** `atomicBatch` is the only multi-statement write
path; the old sequential `batch()` is gone. A request marked accepted without
the friendship it implies (or a round without its entries) is worse than a
failed write, so every batch is one transaction.

## 10g. Watch rooms — one contract, both ends (2026-11-08)

The watch-party wire format was implicit: the node's handlers took `msg: any`
and coerced whatever arrived (`Number(msg.position)`, `String(msg.party)`,
`Boolean(msg.on)`), while the client took `msg: any` and coerced every
payload field back (`String(q.url)`, `Number(q.size)`). A malformed frame
therefore became a room with a blank name and a queue of empty entries, and
neither side could say what the other actually sent.

- **The contract lives in `packages/protocol/src/watch-frame.ts`** — the
  shared package both sides already import. It holds the inbound frame
  (`WatchFrame` + `parseWatchFrame`), the outbound payloads (`WatchPayload`,
  a closed union) and the shapes that travel (`PartyFrame`, `QueueEntry`,
  `ChatEntry`).
- **Both directions are NARROWED, never coerced.** A field of the wrong type
  is DROPPED; unknown keys never reach a handler. `parseWatchServerFrame`
  covers everything the node sends (the room payloads plus `watch.nack`,
  `watch.kicked`, `watch.gone` and `watch.pong`).
- **The persisted room snapshot is narrowed too.** The file on disk is not
  trusted: `restoreParties` drops a corrupt frame, queue entry or chat line
  instead of coercing it, and a stored `rate` other than 1 is a corrupt row
  (party speed is locked at 1x).
- **An absent `rev` means UNVERSIONED**, not revision 0. The client applies
  an unversioned frame (there is nothing to compare it to); revision 0 would
  read as stale and silently freeze the room.

The node's own room state (`Party`, `PartyMember`) stays in
`apps/api/src/watchparty.ts` — the contract is what travels, the room is
what it lives in.

## 11. Save

- zustand state → localStorage `gmatch.save.v1`, autosave every 10s + on unload.
- No offline earnings: the clicker pays on clicks only, so there is nothing to
  collect when the app reopens.

## 12. Server topology (per-install node, opt-in client mode)

- Every packaged copy bundles its OWN server: `apps/desktop/scripts/stage-api.cjs`
  stages a self-contained API (`packages/{crypto,shared}` + `apps/api` + prod
  deps + `bun.exe`) at `api-stage/`; electron-builder ships it as
  `resources/api` (`extraResources`). Nothing must be installed on the machine.
- Packaged startup (`electron/main.cjs` + `electron/server-mode.cjs`):
  - **host** (default since 2026-10-21): spawns the bundled server on
    `:8790` (world data lives in `userData/orbit.sqlite` + `userData/blobs`);
    the Server tab lists this machine's LAN URLs (`http://<ip>:8790`) to share
    with friends. There is no hosted world to dial (nothing hosted is in the
    loop since 2026-11-07), so a packaged build with no stored mode starts
    its own node.
  - **Resilience (2026-11-24):** the bundled server is supervised — a crash or a
    failed health probe restarts it with capped backoff, and the roster re-pulls
    on window focus, so leaving the app idle and returning to the profile no
    longer reads as "nothing loaded".
  - **Timeline survives navigation (2026-11-24):** opening another player's
    profile no longer clears `myProfilePosts`, so returning to the feed keeps my
    own local/P2P posts even when `/api/posts` times out.
  - **Deleting local posts (2026-11-24):** `deletePostOnServer` maps a transport
    failure (503/408/425/429) to a LOCAL tombstone — a P2P/local post has no row
    on the node, so a busy/offline node can no longer leave "invalid" posts
    undeletable. A definitive 4xx refusal is still reported as a failure. The
    rule lives in the pure `utils/deleteOutcome.ts` (unit-tested).
  - **Bounded runtime (2026-11-24, corrected):** the renderer heap is capped at
    256MB (`--max-old-space-size=256`), the decorative full-stage `blur-2xl`
    cover is gone, and videos do not autoplay. The earlier attempt to force
    software composition (`disableHardwareAcceleration`) and throttle hidden
    windows made the UI stall/go black on a real machine, so both were
    REVERTED: the GPU process is cheap compared with a frozen renderer.
  - **No retry storm (2026-11-24):** an `orbitFetch` timeout used to cost 30s +
    2 exponential retries (up to 90s each); with a dozen pollers this piled up
    into a renderer freeze. Normal API calls now time out in 8s with ONE short
    retry (250ms); only actual media streams keep the long budget. Poll cadence
    was relaxed too (lobby 5/8/12s, heartbeat 20s, roster re-pull at most once
    per 15s on focus) — the WebSocket already pushes changes. A failed media
    resolution is cached for only 30s so a returned node/seeder is retried.
  - **client** (opt-in in the Servers page): talks to someone else's node —
    a friend's machine or any `http(s)://host[:port]` the user was given
    (validated, applied on relaunch). `gmatch_SERVER_URL` env overrides both.
    There is **no fallback to a hosted default**: a machine with no node and no
    stored URL is a machine whose node is not running, and the UI says so
    instead of silently dialing a dead host.
  - **A stored client pointer is resolved, never assumed (1.6.5).** Two shapes,
    two rules. A pointer written by an **older app** (no `v` stamp) is moved to
    `paused:true` without being dialed — an old deployment can still answer
    `/api/health` and still not be this install's world, so provenance, not
    reachability, decides (`pausedReason:'legacy'`). A pointer this app wrote
    (`v:2`) is probed once at launch (`GET /api/health`, 2.5 s bound): an answer
    keeps it as the destination, silence pauses it
    (`pausedReason:'unreachable'`). Either way the launch runs the bundled node
    instead of showing an empty world, `server:state` carries
    `pausedUrl`/`pausedReason`, and the Servers page explains it with Reconnect
    (health-probed, writes `v:2`) / Forget it; Servers shows the same notice.
    Nothing is deleted and no hostname blacklist exists to drift out of date.
    The renderer applies the same standard to its own stored base
    (`clearUnreachableApiBase`): one short probe, then fall through to this
    machine.
  - Nodes are reachable WITHOUT the hub (wave 2): the directory gossips
    through whichever node you are on into `orbit_node_directory_v1`, and
    `gmatch://node/...` codes (`utils/nodeMask.ts`) join a node out-of-band.
- Discovery across machines = everyone on the SAME host's server: WS swarm
  relays presence, `GET /api/users/online` (last_seen ≤ 60s, minus caller)
  seeds a joining client's peer map immediately; WebRTC direct fanout uses
  `defaultIceConfig` — env TURN keeps the forced-relay zero-exposure posture,
  otherwise STUN + community relay candidates without forced transport (§10c
  sanitization applies either way; the WS path is the guaranteed fallback).
- Share links are real, openable URLs: public HTML pages `GET /p/:id` (post)
  and `GET /u/:id` (profile), XSS-escaped, unauthenticated; `GET /api/users/:id`
  serves sanitized profiles. Deep links `#/feed?post=<id>` open the lightbox.
- Build: `cd apps/desktop && npm run dist`. The canonical download is the
  GitHub Release asset, linked from the site manifest `site/release.json`
  (hash, size and build date derived from the shipped exe by
  `site/build-release.mjs`); tagging `v*` fires
  `.github/workflows/release.yml` (lint+typecheck+test gate → GitHub Release
  asset). The page is served by Cloudflare Pages at `https://gmatch.pages.dev`
  from `site/` — a static page, no function and no database (binaries are
  never part of that artifact). Unsigned exe →
  SmartScreen "More info → Run anyway".
- Portable self-updater (`electron/updater.cjs` + `updater-core.cjs`,
  packaged builds only): daily + manual check of the site `release.json`,
  auto-download verified against the published SHA-256 **and** size, then the
  user's "Install & Restart" hands a hidden cmd.exe a bounded swap script
  (3s/6s/10s backoff, 30 tries ≈ 3 min) that moves the new exe over the old
  one and relaunches. On terminal swap failure it **relaunches the OLD exe**
  (the downloaded file stays for manual replacement) so no failure path ends
  with a closed app, and the next attempt needs fresh user consent — no
  automatic update/restart loop exists. The cmd runs `windowsHide` WITHOUT
  `detached`: a detached cmd has no console, so every console exe it calls
  (the retry `ping`) would allocate its own visible window — the old
  "reappearing command prompts" bug. Unverified downloads (missing published
  hash) are never installed. The sidecar's quit-time `taskkill` is likewise
  hidden. A 503 from the release host is the free-tier dyno waking up — an
  error to retry, not a missing release.

### 12b. No hosted WORLD — one hosted RENDEZVOUS (gmatch 2.1)

**Amendment (2026-11-14).** gmatch 2.0 removed the hosted service *and* the
rendezvous, which made "everyone signed in sees each other" impossible without
both machines being publicly reachable. gmatch 2.1 splits the two again:

- **No hosted world.** Still true: no third party stores a profile, a post, a
  like, a presence row or a media byte. Each install keeps its own node, and
  media never leaves the peers.
- **One hosted rendezvous, and it is blind.** `site/functions/api/[[path]].ts`
  (Cloudflare Pages, project `gmatch`) serves sealed mail (`PUT/GET
  /api/mail/:token`, TTL 120 s), the server directory (`GET/POST
  /api/servers`) and `GET /api/health`. Storage is **KV**: envelopes the host
  cannot open, and directory rows (a name + an address). No D1, no Durable
  Object, no WebSocket — the client polls every 20 s, so the egress budget is a
  few hundred bytes per peer.
- **`central.url` defaults to that rendezvous** (`utils/central.ts`). The old
  `isRetiredCourier` drop is gone: the host answers `/api/health` again.
  `none`/`off`/`0` still switches it off, and the app keeps working from the
  node you are on.
- **Why it is safe to point everyone at it:** the courier learns *who* is asking
  for *which* mailbox and the size of the envelope — metadata, not content.
  Presence is derived client-side from signed beacons with a 60 s TTL, so the
  host stores no roster at all.

Everything below is the gmatch 2.0 text, kept because the *world* is still
host-free.

---

### (gmatch 2.0) No hosted service — the own node is the world

**Decision (2026-11-07): there is no hosted service of any kind.** The end
state is **direct peer-to-peer**: no third-party host stores posts, media,
comments, likes, profiles, presence — and no third-party host holds a mailbox
or a directory row either.

- A packaged install starts its **own** full node (local Bun sidecar). That is
  the default world and the only one the app assumes.
- `https://gmatch.pages.dev` is a **static release page** only: the download
  page, the legal pages and `release.json`. The hosted courier function and its
  D1 database were removed (the D1 was emptied, then deleted). `/api/*` on
  that origin returns the page, never courier JSON, and a client that still
  points there fails loudly instead of talking to a stale rendezvous.
- There is **no built-in world row** in Servers: joining is a node code from a
  friend or a row published in the directory. A hub/directory is never a
  destination.
- What remains shared is a **rendezvous**: the directory (who exists and where)
  and sealed mail (signalling, DMs, presence beacons). Both are replaceable;
  the app keeps working with `gmatch.central.url = none` — which is the
  **default** since gmatch 2.0 (`apps/desktop/src/utils/central.ts`). A shared
  hub is opt-in: set `gmatch.central.url` / `VITE_CENTRAL_URL` to a node you
  run.
- A pointer to the retired hosted rendezvous (`*.gmatch.pages.dev`) is dropped
  instead of dialed (`isRetiredCourier` in `central.ts`), so an old install
  cannot keep talking to a service that no longer exists.

Consequences that are already implemented:
- The updater asks **one** public feed (`gmatch.pages.dev/release.json`) and the
  manifest of the node this install talks to, when that node serves one. A host
  that does not answer is skipped instead of blocking the check.
- `site/releases/` is **local staging only** (gitignored): the published
  artifact lives in its GitHub Release and the site links it by absolute URL
  with the hash in `release.json`. A site artifact carrying every historical
  exe is a build-context problem, not a convenience.
- The release feed itself is still a single origin. When it is gone, the
  artifact has to be served by the node (or by the user), and until then the
  updater says "no host answered" honestly rather than pretend the app is up
  to date.

## 13. Servers (directory, federation, admin) — v1.1+
ADR-002 (`docs/ADR-002-servers.md`) é canônico; resumo de operação:

- **Criar**: Servers → "+ Add server" → passo "Host a server" → publica
  nome/descrição/hint no diretório (metadados assinados; conteúdo
  NUNCA sai do seu PC). Heartbeat de 15 min mantém o listing vivo (24h sem ping
  = some da lista).
- **Endereço**: o NÓ sabe como é alcançado (bind 0.0.0.0, porta própria) e
  responde isso em `GET /api/servers/node` → `lanUrls` (IPv4 não-interno,
  sem link-local). O shell empacotado lê a mesma lista pela ponte Electron; um
  build de navegador não tem ponte, então usa a do nó. O hint publicado é o
  endereço LAN que um amigo consegue discar (`pickShareableHint`: 10/8,
  172.16/12 e 192.168/16 primeiro; loopback e link-local nunca).
- **Build de navegador**: o heartbeat REPETE um registro já existente
  (`gmatch.server.register`) e nunca inventa um — publicar esta máquina no
  diretório público é ato explícito (Servers → "+ Add server"), não efeito
  colateral de abrir o app. Um browser apontado para o nó de OUTRA máquina
  (`gmatch_server_url` do proxy de dev) é cliente lá, e não publica o
  endereço daqui.
- **Entrar**: lista única de servidores → clicar a linha (a linha do servidor
  atual é inerte) → `serverSet({mode:'client'})` + relaunch. Colar um código de
  nó é o passo "Join with code" do mesmo "+ Add server" (erro de código inválido
  aparece no próprio campo, sem fechar o diálogo). Servidor com 🔒 pede a senha
  uma vez; ela é verificada NO HOST (scrypt, lockout 5/15min) e a allowlist fica
  no SQLite do host — sem token forjável.
- **Lista**: um nó que hospeda um mundo é um servidor, inclusive o que roda nesta
  máquina — uma linha por endereço (`dedupeServers`), nunca por nome. Não há
  mundo embutido: o app lista o próprio nó, os nós do diretório e os que você
  adicionou por código. O diretório (metadados + mail selado) é infraestrutura
  e não aparece como destino. Grupos locais são rótulo só deste
  dispositivo (rodapé → diálogo), nunca um destino. Nada é assumido online: sem
  resposta do probe, a linha aparece offline e o join falha com aviso, sem
  inventar conexão.
- **Admin**: quem HOSTEIA o nó vê o botão Admin no rodapé da sidebar (PIN da
  suíte admin existente). A suíte de moderação funciona igual em qualquer nó.
- **Dashboard**: `GET /api/servers/dashboard` no nó atual → userlist (ids
  truncados, boolean online 60s), posts/24h, membros. Anônimos veem só números.
- **Snapshot**: admin exporta/importa o JSON do mundo (`/api/snapshot`), o
  mecanismo honesto de handoff v1. Tabelas de segurança/transporte do nó
  (SystemMeta, Sessions, ServerDirectory…) são excluídas por design.
- **Central** (`VITE_CENTRAL_URL` / Settings→Server): diretório + mail selado,
  nada mais; desde gmatch 2.0 o padrão é `none` — o próprio nó é o diretório e
  o relay, e nada hospedado participa (`none` desliga; um hub próprio pode
  substituir). O diretório nunca lê conteúdo de
  nenhum servidor federado.

## 14. Chat (`#/messages`) — reconstruction

`apps/desktop/src/components/chat/`, `hooks/useCourierDms.ts`, `utils/mail-dm.ts`.

Direct messages are the **courier lane**: sealed envelopes (`Envelope v2`)
addressed by delivery tokens, finally decrypted by the recipient's X25519 key.
No node route is involved — `/api/pm` is retired and 404s on every node, so it
was never a real path. Server-hosted lanes (lobby, queue, group chat, game
invites) sit behind an explicit capability probe and show the reason when the
node does not host them.

**Event kinds** — sealed into the mail body, one decoder (`decodeBody`), no
server change. An older client gets an unopenable body kind and ignores it, so
the wire stays compatible: `dm` (send), `dm_ack` (delivery), `dm_read` (read
watermark), `dm_edit` (author-only, last-write-wins on `ts`), `dm_del`
(delete-for-everyone), `dm_react` (per-actor aggregation), `dm_typing`
(transient, never persisted).

**Delivery ladder** — only what the peer actually proved: `sending` →
`delivered` on a real `dm_ack` → `Seen` only from a real `dm_read` watermark
(`readTs >= msg.ts`). Nothing is fabricated: no optimistic "delivered", no
presence invented, no server acknowledgement on the blind courier. A failed
seal renders "not delivered".

**One send, one row (2026-10-19).** `sendPm` used to send first and, on
failure, resolve the peer's keys from the public profile and send *again* —
appending a second row under a new id, so one Enter rendered as two messages
and the first (a failed row no longer at the end of its block) showed no state
at all, reading exactly like one that had landed. The keys are now resolved
**before** the single send attempt (`peerAddressable`, the same probe the
domination mesh uses): same outcome, one row, one fewer wasted attempt.
Delivery-state markers are per message while the block clock stays per block, so
a failed message always says so even when another message follows it.

**Tombstones:** `dm_del` never hard-deletes — a stub row with `deletedAt`
stays, so a replayed envelope cannot resurrect removed content. Edits are
author-only and last-write-wins; inbound reaction/edit/delete events are
attributed to the thread peer and can never touch rows we authored.

**Typing:** never persisted. First ping immediate, then throttled to 3s; a ping
is fresh for 8s and a future timestamp is treated as stale.

**Mail drain (delivery reliability).** The courier pushes a notice only *after*
the envelope is stored, so a box listing already in flight could not contain it.
`MailClient.pull()` coalesces concurrent drains but now **queues one extra pass**
when a notice lands during a drain, instead of absorbing it. That race is why a
DM could sit on the courier until something else happened to pull. Separately,
`MailClient.wsUrl()` built its socket from the (relative) dev API base alone —
`ws:///api/mail/ws`, an invalid URL — so browser-dev mail push never connected
at all; a relative base now rides the page origin via the shared `wsUrlForBase`
(`utils/api.ts`), the same rule the P2P swarm socket uses.

**Read receipts** are view-gated: "Seen" is stamped only while the conversation
is open in the messages/rooms view AND the document is visible. It is never
claimed by the message loader, which also runs when boot restores a conversation
the player never opened.

**Unread state is identity-scoped (2026-10-18).** `dmSeen`, `roomSeen` and the
last-conversation pointer used to live in plain, unscoped localStorage while the
threads and rooms themselves are DPAPI-scoped per identity. Switching identity
therefore inherited the previous user's read stamps, which could hide brand-new
messages. They now go through `utils/scopedSeen.ts` (`scopedKey(key, orbitId)`),
with a one-time migration of the legacy value so an upgrade never loses read
state.

**The unread badge is derived, never stored twice.** Per-thread and per-room
unread comes from the message store itself (`countThreadUnread` / `countMentions`
against the seen stamps), and the notification centre reads the *same* stamps
(§15). There is no second "unread" scalar to drift out of sync with the list,
and a message that is merely delivered is never shown as read.

**Profile modal:** wide two-column grid — left pane the user's posts, right pane
the selected post, each independently scrollable; a post opens on the right
without closing the modal. Layered Escape (picture → card → post → modal) with
focus restored to the trigger.

**Invites** remain server-authoritative (the existing invite protocol — no
sealed-invite variant, and no invite-as-text-message). Because `detectMailMode`
cannot tell a full node from a blind courier (both answer "courier"), the node
is probed separately: an unauthenticated `GET /api/lobby/invites` returning 404
means blind (`utils/nodeCapabilities.ts`, cached per node). The invite action is
then disabled with the reason instead of failing as a 404 toast, and the
lobby/queue/group composer is replaced by a notice. Courier DMs and sealed rooms
are exempt — they never touch the node.

**Last conversation** is restored on boot (`gmatch_last_dm_peer_v1`);
**search** covers local DMs and rooms only, via a bounded lazy index (5000
messages / 50 results) that reports `truncated` honestly.

**Limitations (documented, not hidden):** sealed group rooms stay **text-only**
— reply/edit/delete/reactions/typing need a per-room sealed event path that does
not exist yet; server group history is unindexed; lobby, queue, group chat and
game invites require a node that hosts them; swarm byte transfer remains
unverified (§10d).

**Tests:** `e2e/chat-two-peer.spec.ts` drives two independent browser contexts
(separate identities, keys, mail sockets) through the real envelope path:
send → Delivered-without-Seen → unread badge → Seen on open → typing → reply
quote → author-only edit → cross-peer reaction → delete-for-everyone tombstone →
reload persistence, plus an honest "not delivered" state when sealing fails.
`e2e/chat-node-capability.spec.ts` route-mocks the 404 probe (clearly labelled:
the E2E node is a full node) and asserts the disabled invite with its reason,
the lobby composer notice, and the still-working DM lane on the same client.

## 15. Notifications — one header centre (2026-10-18)

`components/notifications/NotificationCenter.tsx` is the **only** notification
entry point. It is mounted by `NativeHeaderBar` (so it exists on every viewport
and every view) and absorbed the four bells that used to compete with it: the
header island's, `CommandIsland`'s footer entry, the `FeedHeader` pill, and the
duplicate mobile modal. There is no separate notifications page, and the
left-rail dock is gone. The trigger keeps
`data-notifications-toggle="true"` — the E2E hook
(`e2e/engagement-social.spec.ts`) and its "Mark all read" expectation still hold.

### Two sources, one list

1. **Server rows** — the persistent `Notifications` table (`GET /api/notifications`,
   pushed over WS as `type: 'notification'`). Authoritative for anything that
   happened while this client had no local copy: likes, comments, replies,
   mentions, comment likes, follows, match invites/results, babecock, card
   events, system.
2. **Derived local rows** — the sealed courier lanes (DMs, rooms). The courier is
   blind and `/api/pm` is retired, so no server can know an unread DM exists.
   The row is derived from the **message store itself** via the same seen stamps
   the chat badge uses (`utils/notifications.ts` `deriveConversationNotifications`,
   hook `hooks/useNotificationCenter.ts`). Reading the row is the same action as
   opening the conversation, and it emits a real `dm_read` receipt — so the
   notification is never a second, drift-prone copy of the message state.

`mergeNotifications` folds both into `AppNotification`s keyed by
`notificationKey`; the unread badge and the per-type breakdown are computed
**from the merged items**, never from a separate counter (`unreadCountOf`,
`unreadByTypeOf`). Server list cap = the badge cap (50).

### Rules honoured

- **Never notify yourself.** Every server call site checks the actor against the
  recipient (comment/reply/mention/comment-like/like); mentions resolve against
  real `Users` rows, so a plain `@word` that names nobody notifies nobody.
- **No repeat rows.** `createNotification` (`apps/api/src/notifications.ts`)
  derives an event key from type + identifying `data` fields and compares it
  against recent rows; a duplicate returns `null`, which every caller already
  reads as "do not broadcast". The window is **bounded (5 min)** on purpose: a
  retry/double-tap/replayed frame lands in seconds, while a genuinely new later
  event (like → unlike → like again, unfollow → re-follow) must still notify.
  No migration, no new column.
- **Edits don't renotify.** Edits never create a notification, so there is
  nothing to suppress.
- **Canonical targets, graceful fallback.** Rows carry `{ postId?, commentId?,
  conversationId?, userId?, inviteId?, matchId? }`; `handleOpenNotificationTarget`
  navigates to `#/feed?post=<id>&comment=<id>`, opens the profile, or hands the
  row to the local (courier) handler. A comment deep link scrolls the comment
  into view and spotlights it once the list loads; a delete that removes the
  post/comment degrades to the post, then to the feed, never to nowhere.
- **Replies are real.** `Comments.parent_comment_id` (dead since migration 016)
  is now written, validated (the parent must be a live comment on this post),
  read back, and rendered nested; a reply notifies the parent's author with that
  id in `data`, so the notification lands on the exact comment.
- **Explicit reads only.** Opening the centre does not mark anything read.
  Tapping a row marks that row (and, for courier rows, emits the read receipt);
  "Mark all read" marks all. This avoids claiming a read that did not happen and
  avoids a server round-trip per dropdown open. "Mark all read" clears the
  server rows only: a courier row is a real unread **message**, so it is cleared
  by opening the conversation, never dismissed like an alert.
- **Backgrounded window.** A courier DM/room message that arrives while
  `document.hidden` raises an OS notification with the **sender name only** (no
  message body — a sealed DM must not land on a lock screen), tagged per
  peer/room so repeats collapse. Reconnect catch-up is one forced read
  (`__ws_reconnected` in `useLobby`), not a polling loop.

### Limitations (honest, not hidden)

- Server rows are pruned after **48h** by the maintenance sweep and the API
  returns at most **50** (`cleanup.ts`). Notification history is therefore a
  recent window, not an archive.
- An event that happened while this client was offline is recoverable **only if
  a server-side row exists** (likes, comments, replies, mentions, follows, card
  and match events). Courier DMs have no durable relay, so a DM that a peer
  never delivered is simply not there — the UI never claims guaranteed offline
  delivery, and the two systems stay consistent by deriving local rows rather
  than by syncing anything.
- Not built (features do not exist, so nothing is fabricated): friend requests,
  post emoji reactions (posts have `like` only), watch-party invites, and
  office-side `system` events.
- DM display names are self-declared labels (the payload name wins over the
  directory); identity is signature-verified, so a notification never authorizes
  on a name.
- **An unnamed peer does NOT raise a notification (2026-11-25).** A derived DM
  row whose peer has no real display name (payload name absent, no directory/cached
  name) is **suppressed** — no random "`User_abc123` sent you a message" alert.
  The chat badge still shows the thread; only the notification is dropped. The
  readable handle (`generateFallbackName`) remains the label everywhere the peer
  is actually rendered (chat, roster, gallery), never a truncated hash fragment.
- `MAX_PER_THREAD = 2000` truncates DM history, and multi-machine swarm delivery
  remains unverified (§10d).

**Tests:** `utils/notifications.test.ts` (merge/derive/counts),
`utils/scopedSeen.test.ts` (scoping + legacy migration),
`components/notifications/NotificationCenter.test.tsx` (single toggle hook,
badge, inbox affordance, courier rows), and the API suite
`routes/posts-notifications.test.ts` (comment/reply/mention/comment-like
coverage, self-notification guards, cross-post parent rejection, bounded
idempotency).

## 16. Discoverability and catch-up (2026-10-30)

Three things were technically present and practically invisible: the community
invite, the notification bell, and posts written while the window sat in the
background. Each is a one-owner fix, not a second system.

- **Community invite is one shared lookup.** `services/community.ts` reads the
  node's public `GET /api/discord-invite` (`SystemMeta.discord_invite_url`,
  set from the admin panel) and falls back to the constant
  `https://discord.gg/Xkqb6U4Na` when a fresh local node has none or the node is
  unreachable. The same hook feeds the header item
  (`CommandIsland`), Settings → Preferences (`CommunitySection`) and the top of
  the Help modal. Non-`http(s)` values are rejected, never opened.
- **The bell says what it is.** `NotificationCenter` renders the bell at
  `w-4 h-4` in a 7×7 chip, accent-filled when unread, with a visible
  `Notifications` label above the preview (the preview stays for sm+). The
  toggle, badge and keyboard behaviour are unchanged; only affordance is.
- **Background and late-joiner sync.** `App` refreshes the feed on
  `visibilitychange`/`focus` (at most once per 15s) and polls once a minute
  while hidden, so the feed is warm before the user looks. A hidden window is no
  longer skipped. On `PEER_ONLINE_EVENT`, `useP2P` still sends pending
  operations and now also re-offers a bounded slice of recent log entries
  (`broadcastRecentOperations`: newest 120, ≤7 days, throttled to one wave per
  20s) so a peer that joined after an operation was acked still receives it.
  Receivers dedupe by operation id; the wave never rewrites delivery status.
- **Cross-world media asks the swarm.** A DM attachment's metadata row lives on
  the sender's node only, so `/api/objects/<id>` 404s on the recipient's world.
  `useObjectImage` now asks the swarm by object id before declaring a miss (and
  before firing `orbit-object-404`), then caches the bytes locally. A node 404
  alone is no longer proof that the bytes do not exist.

**Tests:** `services/community.test.ts` (node value, fallback, offline,
non-http rejection, cache), `services/socialOpTransport.test.ts`
(re-offering delivered operations, count/age bounds),
`hooks/useObjectImage.swarm404.test.ts` (swarm fallback + honest miss).
