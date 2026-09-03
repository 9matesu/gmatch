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
| Blue Cap | 150 GP | x2 click power, 60s |
| Goon Filter | 900 GP | auto-click 1/s, 120s |
| Hypno Drop | 5k GP | x2 passive GP/s, 180s |
| Brain Melt | 50k GP | x10 everything, 30s |

Stacking: different caps stack; same cap refreshes duration.

## 6. Booru sources (main-process fetch, 10s timeout, round-robin health)

- tbib: `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=<t>&limit=<n>&json=1` (JSON; full url = `https://tbib.org/images/<directory>/<image>`)
- safebooru: same DAPI shape, `https://safebooru.org/...` (JSON array, has `file_url`)
- paheal: `https://rule34.paheal.net/api/danbooru/find_posts?tags=<t>&limit=<n>` (XML `<tag file_url=...>`; query single tags only — combos return 0)
- e621: `https://e621.net/posts.json?tags=<t>+rating:explicit&limit=<n>` (JSON; `posts[].file.url`)
- Browser/dev mode: direct fetch may CORS-fail → offline SVG placeholder
  (generated gradient + tag text + "OFFLINE" badge). Never crash on fetch error.
- Dedupe by post id across a session; cache last 40 urls.

## 7. UI (modern dark glassy, BabecockPanel flavor)

- Single window, 3 columns: left = stats/pornification ladder, center = Goon
  Panel (big clickable image, splat FX, buy-image + caps bar), right = tabbed
  shop (Tags / Gallery / Caps / Prestige).
- Style: `bg-black` app shell, panels `bg-surface-raised`-like `rgba(255,255,255,0.04)`
  + `border-white/10` + `rounded-2xl` + `backdrop-blur`, accent hot pink→violet
  gradient, monospace numbers, floating `+GP` texts, subtle pulse on affordable items.
- Age-gate overlay on first launch (must tick "I am 18+"). NSFW blur toggle in
  header (blurs images until hover) — default ON.
- Toasts for purchases/unlocks; offline-earnings modal on load.

## 8. Hard blocklist (reject tag if ANY substring matches; case-insensitive)

`loli, shota, child, kid, infant, baby, toddler, school, student, uniform-ish
minor terms, ageplay, incest, bestiality, zoo, necro, rape, non-consent, gore,
scat, urine, blood, murder, death`. Also reject posts whose rating is not
explicit/adult on e621. This list is enforced in `src/game/tagFilter.ts` with
unit tests — it is the most important tested module in the repo.

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
