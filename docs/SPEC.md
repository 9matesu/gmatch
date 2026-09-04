# GoonGrid — Game Design Spec

A pervert idle/clicker game. You click pictures to earn **Goon Points (GP)**,
buy **tags** (parsed live from booru sources) that generate passive GP and
reshape your idle feed, buy the images themselves into your **Gallery**,
pop **GoonCaps** for temporary buffs, climb the **Pornification** ladder, and
**Brainmelt** (prestige) to become permanently more corrupt.

## 1. Core loop

1. An image fills the center "Goon Panel" (fetched from a booru by owned tags).
2. Click it → +clickPower GP, splat animation, +XP. Every 25th click is a
   **CRIT** ("cumshot flash") worth x10.
3. Spend GP in the Tag Market / Image Shop / GoonCap Vending Machine.
4. Owned tags tick passive GP/s and bias which images appear.
5. Reach Pornification tier thresholds → new titles, UI accents, unlocks.
6. Brainmelt (prestige) resets GP/tags for Corruption shards (+10% global mult each).

## 2. Currencies

- **GP** — main currency (clicks + passive).
- **XP** — drives Pornification tier (never resets within a run).
- **Corruption shards** — prestige currency, persists through Brainmelt.

## 3. Tags (the "appliances" market)

- On boot the client fetches ~60 posts from a random healthy source, splits the
  booru `tags` field, filters blocklist (§8) + noise, ranks by frequency, and
  offers the top ~24 as purchasable tags (refresh button re-parses).
- Each tag: `cost = base * 1.15^owned`, `income` GP/s, `weight` (feed bias).
  base/income derived from tag length + frequency (rarer tag = pricier = better).
- Max 20 owned levels per tag. Owned tags list = the feed query (top 5 by level).
- A few evergreen starter tags always seeded so the market is never empty:
  `1girl, solo, long_hair, smile, closed_eyes, wet, lingerie, cosplay`.

## 4. Images & rarity (ORBIT card-valuation flavor)

- "Buy this image" button on the current image: cost = `rarityBase * 1.1^gallerySize`.
- Rarity ladder from clicks+price (ORBIT-style): Common 0-99, Copper 100-499,
  Silver 500-1499, Gold 1500-4999, Diamond 5000+.
- Owned images: +GP/s each (by rarity: 1/3/10/30/100), shown in Gallery tab,
  click any owned image in the gallery to re-feature it in the Goon Panel.
- Gallery persists through Brainmelt (the "keepsakes").

## 5. GoonCaps (consumable buffs) — vending machine

| Cap | Cost | Effect |
|---|---|---|
| E-Girl Spit | 150 GP | x2 click power, permanent |
| Braceface | 900 GP | auto-click 1/s, permanent |
| Pornmeat | 5k GP | x2 passive GP/s, permanent |
| Brain Drain | 50k GP | x10 everything, permanent |

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
- Picture + feed caching (no re-parse, no re-download): parsed post lists are
  cached per query for 10 min (`<userData>/feed-cache.json`, 100 queries max);
  picture bytes are cached on disk in `<userData>/image-cache/` (400 files /
  400 MB, LRU-evicted, `gooncache://` scheme) in Electron, or IndexedDB blobs
  in browser dev mode. The 5-up/5-down window (past 5 + queue 5 + video
  posters, images AND videos) is prefetched so skip/back is instant; cache
  stats + Clear live in the left stats panel.

### 6b. Feed/market queries (user spec: no vanilla)

- Starter tags + market seeds come from `src/game/pervertTags.ts` — a weighted
  pool of 40+ hard tags (gangbang, pregnant, impregnation, breeding,
  veiny_penis, bulge, ahegao, deepthroat, double_penetration, anal, creampie,
  bbc, black_cock, interracial, skylar_vox, bimbo, femdom, goon_caption,
  caption, ...). No vanilla tags (1girl/solo/romance) anywhere in the pipeline.
- Feed/market query = top-3 owned tags + 2 weighted pervert seeds (3 seeds when
  nothing is owned). Seeded tags are never blocklisted (tested invariant).

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
  gradient, monospace numbers, floating `+GP` texts, subtle pulse on affordable items.
- Age-gate overlay on first launch (must tick "I am 18+"). NSFW blur toggle in
  header (blurs images until hover) — default ON.
- Toasts for purchases/unlocks live in the header 🔔 tab (capped at 50, no
  floating overlay spam); offline-earnings modal on load.
- Tags tab: owned pills toggle ON/OFF plus SOLO (feed only that one tag).
  Gallery tab: text box filters keepsakes by tag substring.

## 8. Hard blocklist (reject tag if ANY substring matches; case-insensitive)

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
- Shards = floor(sqrt(totalEarnedGP / 1e6)); each shard +10% global multiplier.
- Resets: GP, XP/tier, tags, caps. Keeps: gallery images, shards, achievements.

## 10. Achievements (small, spicy, 12 total)

First Click, 100 Clicks, First Tag, Tag Collector (10 tags), Gallery of Sins
(10 images), Diamond Hands, Crit Addict (50 crits), Cap Connoisseur (all 4),
First Brainmelt, 10 Shards, Goon Master (tier 10), Offline Slut (collect
offline earnings). Each +5% click power. Persist across prestige.

## 11. Save

- zustand state → localStorage `goongrid.save.v1`, autosave every 10s + on unload.
- Offline earnings = elapsed * GP/s * 50%, capped 8h, shown in modal on load.
