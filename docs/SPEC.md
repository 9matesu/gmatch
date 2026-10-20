# gmatch — Product Spec

One Electron desktop app, one multiplayer game. The **gmatch shell** (feed,
card duels, chat, P2P, hacks, moderation, admin — vendored from the orbit repo
in the 2026-09 merge) wraps the **Babecock · Idle** game (ex-GoonGrid): click
pictures to earn **pts**, buy **tags** (parsed live from booru sources) that
generate passive income and reshape your idle feed, buy images into your
**Gallery**, pop **GoonCaps**, climb the **Pornification** ladder, and
**Brainmelt** (prestige). Idle pts are a local-only currency (the save file);
the server g$ ledger (`EconomyService`) backs duels, lootboxes, hacks and
trades — two separate economies, no bridge between them.

## 0. Architecture (merge plan D1–D9)

- npm workspaces: `apps/desktop` (Vite + React 19 + Tailwind 4 renderer,
  Electron 33 shell), `apps/api` (Orbit Hono API, vendored), `packages/{crypto,
  protocol,shared}` (vendored verbatim).
- The API runs as a **local Bun sidecar** spawned by Electron main
  (`apps/desktop/electron/apiSidecar.cjs`): port 8790, SQLite snapshot + blob
  store under `userData`. Renderer base: `window.__API_BASE__` (preload) or
  `VITE_API_URL`. Identity = client Ed25519 keypair (`@orbit/crypto`); every
  request signed (`orbitFetch`).
- UI authority: Orbit's retro-glass Tailwind design system (shell). The idle
  game renders inside the shell's `grid` view, restyled to Tailwind 4 with
  shared recipes in `src/ui/styles.ts` (legacy goongrid.css deleted; only
  keyframes remain in `src/ui/grid-animations.css`).
- Single 18+ gate: the shell's `AgeGateModal` (mirrored into the idle store).
  Single onboarding: `firstRun/OnboardingFlow` includes the feed-tune step
  (pick exactly 4 starter tags + excludes). Excludes editor lives in the
  settings modal's Feed tab.
- Single media picker (2026-10-18): every media entry point (create post /
  story, profile photo, card forge, Domination wallpaper/game_bg/popup_video)
  opens the shared `MediaPickerModal` (`src/components/media/`) — Browse
  (idle keepsakes, tag-filterable), Upload (drop/paste), URL (preview +
  validate). Contract in `picker.ts` (`MediaSelection`, `selectionToFile`):
  keepsake/loopback URLs are fetched to real Files before upload, popup_video
  stays URL-only (a local File has no URL a remote peer could open).
- Two booru clients by design: idle feed via Electron IPC
  (`apps/desktop/src/services/booru.ts`, SPEC §6) and social feed via the
  server proxy (`apps/api/src/routes/booru.ts`) — different trust domains.
- Excluded from the merge (documented, not silently dropped): `apps/discord`
  bridge, fly.io infra, Rust `image-processor` (unused).

## 1. Core loop

1. An image fills the center "Goon Panel" (fetched from a booru by owned tags).
2. Click it → +clickPower pts, splat animation, +XP. Every 25th click is a
   **CRIT** ("cumshot flash") worth x10.
3. Spend pts in the Tag Market / Image Shop / GoonCap Vending Machine.
4. Owned tags tick passive pts/s and bias which images appear.
5. Reach Pornification tier thresholds → new titles, UI accents, unlocks.
6. Brainmelt (prestige) resets pts/tags for Corruption shards (+10% global mult each).
7. **Heat combo**: clicks within 2s of each other stack a streak; every 10
   clicks adds +0.25x click power (cap x3). Idling past the window resets it.
   Session-only streak; the best streak ever persists (`maxHeatStreak`) and
   unlocks the Heat Demon achievement (80). Float texts show `+N xM`.

## 2. Currencies

- **pts** — the idle game's currency, LOCAL ONLY (2026-09-11 simplification):
  earned by clicks + passive income, spent in the Tag Market / Image Shop /
  GoonCap Vending Machine. Lives in the localStorage save; never synced to the
  server. The old `idle-credit`/`idle-debit` ledger bridge (plan D4) was
  removed with `economy-idle.ts`, `walletBridge` and `walletSync`.
  Legacy saves migrate `gp`/`gc`/`totalEarnedGP`/`totalEarnedGc` →
  `points`/`totalEarned` (same value, renamed).
- **g$** — the server ledger currency (`EconomyService` is authoritative):
  duel stakes, lootboxes, hacks, trades, store purchases. Idle no longer
  feeds it; you earn g$ through the shell's social/game loops only.
- **XP** — drives Pornification tier (never resets within a run).
- **Corruption shards** — prestige currency, persists through Brainmelt.

## 3. Tags (the "appliances" market)

- On boot the client fetches ~60 posts from a random healthy source, splits the
  booru `tags` field, filters blocklist (§8) + noise, ranks by frequency, and
  offers the top ~24 as purchasable tags (refresh button re-parses).
- Each tag: `cost = base * 1.15^owned`, `income` pts/s, `weight` (feed bias).
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
| Braceface | 900 pts | auto-click 1/s, permanent |
| Pornmeat | 5k pts | x2 passive pts/s, permanent |
| Brain Drain | 50k pts | x10 everything, permanent |

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
  top-2 tags → leading tag, per source, first non-empty wins.
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
  floating overlay spam); offline-earnings modal on load.
- Publishing a post shows it immediately: the upload response (its bytes are
  already durable locally) becomes an optimistic feed tile, and the node is
  re-read through a cache-bypassing refresh until it lists the row
  (`utils/feedPublish.ts`, bounded retries). Dedupe is by post id, so the tile
  never doubles; a post the node never lists stays visible as locally durable
  instead of vanishing, and a failed upload inserts nothing (the modal reports
  the reason and stays open).
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

`electron/main.cjs` implements the identical `hitsAtTokenStart` rule. The
renderer and the main process enforce the same hard line, so the two
implementations must not drift; a parity check lives in the tagFilter suite.

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
count-tag noise (`1girl`, `solo`, `2boys`, ...). Unit tests in
src/game/tagFilter.ts — it is the most important tested module in the repo.

## 9. Prestige — Brainmelt

- Available at Pornification tier 5+ ("Pervert").
- Shards = floor(sqrt(totalEarned / 1e6)); each shard +10% global multiplier.
- Resets: pts, XP/tier, tags, caps. Keeps: gallery images, shards, achievements.

## 10. Achievements (small, spicy, 13 total)

First Click, 100 Clicks, First Tag, Tag Collector (10 tags), Gallery of Sins
(10 images), Diamond Hands, Crit Addict (50 crits), Cap Connoisseur (all 4),
First Brainmelt, 10 Shards, Goon Master (tier 10), Offline Slut (collect
offline earnings). Each +5% click power. Persist across prestige.

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

## 10c. P2P privacy (ICE hygiene — non-negotiable)

- Single source of truth: `apps/desktop/src/utils/ice-hygiene.ts` (client) +
  `candidateLeaksIp` in `apps/api/src/routes/signal.ts` (server gate).
- Outgoing ICE candidates are sanitized on both P2P stacks (file-transfer
  OrbitPeer + PeerJS relay): literal-IP `host` candidates and ALL `srflx`/
  `prflx` candidates are dropped — only mDNS `.local` hosts and TURN `relay`
  candidates ever reach a peer. Unknown shapes fail closed.
- The signal server re-validates every posted candidate (defense in depth
  against a malicious peer) and 400s raw-IP ones.
- TURN env (`NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL`) flips the config to
  `iceTransportPolicy: 'relay'` — fully relayed calls, zero IP exposure.
  Without TURN, STUN stays for connectivity but srflx never leaks onward.
- Wave 2 (masks): peers address each other ONLY through delivery tokens
  rendered as `handle.gmatch.com/<token>` (`utils/maskAdapter.ts`); tokens
  rotate per boot (`utils/handleRotation.ts`, epoch travels sealed inside
  dm/ack bodies). Node coordinates share as `gmatch://node/...` codes
  (`utils/nodeMask.ts`) and the directory gossips through the node you are
  on, so nodes stay reachable without the hub. Every image entering or
  leaving the app is metadata-stripped (`apps/api/src/metadata-strip.ts`);
  post tags live in the DB, never in the file.

## 10d. P2P Swarm & Blind Courier Presence (ARCHITECTURE-P2P.md)

- Central courier (`https://gmatch-wcz1.onrender.com`) is strictly a blind, zero-knowledge
  forwarder (`SITE_SERVICES=mail,turn,admin`). All legacy central routes (`/api/users/online`,
  `/api/posts`, `/api/objects`, `/api/signal/*`) intentionally 404.
- **Presence & Discovery:** Ephemeral signed beacons (`PresenceBeacon`) broadcast to public
  presence token `sha256Hex('orbit-global-presence-v1')`. Client compiles and verifies in-memory
  roster with 60s TTL and 120s drop threshold. Zero presence state stored on server.
- **Signaling over Courier:** WebRTC signaling (SDP offer/answer, ICE) sealed with X25519 ECIES
  and routed as `kind: 'signal'` envelopes via `/api/mail/:token`.
- **Swarm Media Distribution:** Media divided into 64KB chunks (`SWARM_WANT`, `SWARM_CHUNK`)
  over direct WebRTC DataChannels (`gmatch-mesh`). All received/created media stored in local
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
- **Descriptor vs bytes:** `data` is media, nothing else. An announcement's link is
  stored as `source_url`; publishing or receiving one never overwrites bytes already
  held. Legacy rows that wrote the URL into `data` are recovered idempotently on read
  (nothing deleted, nothing re-imported) and render from the link. An `owner_id` that
  contradicts the proven `relayedBy` sender is stored `owner_verified: false` and
  never borrows that user's directory name or avatar.
- Full specification documented in `docs/ARCHITECTURE-P2P.md`.

## 11. Save

- zustand state → localStorage `gmatch.save.v1`, autosave every 10s + on unload.
- Offline earnings = elapsed * pts/s * 25%, capped 8h, shown in modal on load.

## 12. Server topology (central courier + opt-in host mode)

- Every packaged copy bundles its OWN server: `apps/desktop/scripts/stage-api.cjs`
  stages a self-contained API (`packages/{crypto,shared}` + `apps/api` + prod
  deps + `bun.exe`) at `api-stage/`; electron-builder ships it as
  `resources/api` (`extraResources`). Nothing must be installed on the machine.
- Packaged startup (`electron/main.cjs` + `electron/server-mode.cjs`):
  - **client** (default): the central node `https://gmatch-wcz1.onrender.com` — a blind
    courier (mail + TURN only; content routes 404 at the edge). A persisted
    `userData/server-mode.json` may point at any friend's node instead
    (validated `http(s)://host[:port]`, applied on relaunch).
    `gmatch_SERVER_URL` env overrides both.
  - **host** (opt-in in Settings → Server): spawn the bundled server on
    `:8790` (world data lives in `userData/orbit.sqlite` + `userData/blobs`);
    the Server tab lists this machine's LAN URLs (`http://<ip>:8790`) to share
    with friends.
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
  fly-hosted site (`https://gmatch-wcz1.onrender.com/releases/gmatch-<version>-portable.exe`
  + hash in release.json, see site/build-release.mjs); tagging `v*` also fires
  `.github/workflows/release.yml` (lint+typecheck+test gate → GitHub Release
  asset), used for mirrors, not the primary link. Unsigned exe → SmartScreen
  "More info → Run anyway".

## 13. Servers (directory, federation, admin) — v1.1+

ADR-002 (`docs/ADR-002-servers.md`) é canônico; resumo de operação:

- **Criar**: Servers → "+ Add server" → passo "Host a server" → publica
  nome/descrição/hint no diretório do central (metadados assinados; conteúdo
  NUNCA sai do seu PC). Heartbeat de 15 min mantém o listing vivo (24h sem ping
  = some da lista).
- **Entrar**: lista única de servidores → clicar a linha (a linha do servidor
  atual é inerte) → `serverSet({mode:'client'})` + relaunch. Colar um código de
  nó é o passo "Join with code" do mesmo "+ Add server" (erro de código inválido
  aparece no próprio campo, sem fechar o diálogo). Servidor com 🔒 pede a senha
  uma vez; ela é verificada NO HOST (scrypt, lockout 5/15min) e a allowlist fica
  no SQLite do host — sem token forjável.
- **Lista**: um nó que hospeda um mundo é um servidor, inclusive o que roda nesta
  máquina — uma linha por endereço (`dedupeServers`), nunca por nome. O courier
  central (mail/turn/diretório) é infraestrutura e não aparece; o mundo oficial
  `gMatch Central` continua visível, como qualquer outro destino, sem etiqueta de
  tipo. Grupos locais são rótulo só deste dispositivo (rodapé → diálogo), nunca
  um destino.
- **Admin**: quem HOSTEIA o nó vê o botão Admin no rodapé da sidebar (PIN da
  suíte admin existente). A suíte de moderação funciona igual em qualquer nó.
- **Dashboard**: `GET /api/servers/dashboard` no nó atual → userlist (ids
  truncados, boolean online 60s), posts/24h, membros. Anônimos veem só números.
- **Snapshot**: admin exporta/importa o JSON do mundo (`/api/snapshot`), o
  mecanismo honesto de handoff v1. Tabelas de segurança/transporte do nó
  (SystemMeta, Sessions, ServerDirectory…) são excluídas por design.
- **Central** (`VITE_CENTRAL_URL` / Settings→Server): diretório + nada mais;
  o central não consegue ler conteúdo de nenhum servidor federado.

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
- **The name fallback is a readable handle, never a raw id (2026-10-19).** When a
  DM/room row has no payload name, no directory entry and no cached peer name,
  the row shows `generateFallbackName(peerId)` (`User_abc123` — the same handle
  `courierPresence`, the lobby and the gallery owner label already use) instead
  of a truncated hash fragment (`peerId.slice(0, 10)`), which named nobody and
  disagreed with every other surface. The canonical `actorId` still carries the
  full id for routing, dedupe and authorization; only the display label changed.
- `MAX_PER_THREAD = 2000` truncates DM history, and multi-machine swarm delivery
  remains unverified (§10d).

**Tests:** `utils/notifications.test.ts` (merge/derive/counts),
`utils/scopedSeen.test.ts` (scoping + legacy migration),
`components/notifications/NotificationCenter.test.tsx` (single toggle hook,
badge, inbox affordance, courier rows), and the API suite
`routes/posts-notifications.test.ts` (comment/reply/mention/comment-like
coverage, self-notification guards, cross-post parent rejection, bounded
idempotency).
