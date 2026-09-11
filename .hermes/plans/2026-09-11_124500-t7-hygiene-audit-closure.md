# Plan: T7 closure — idle feed hygiene audit (done this turn)

Goal: prove retrieval health with grep + live probes, fix what the audit
surfaces, and prune the plan items the code already covers.

## Findings (verified 2026-09-11)

1. ONE gate, five paths: every response path (IPC, dapi/moebooru direct,
   redgifs, realbooru-html, paheal) funnels through
   `remember(sanitize(posts, query))` — booru.ts:404-571. The T4
   co-occurrence filter was added INSIDE sanitize, so the IPC path is covered
   too. No fix needed; plan's fallback finding does not apply.
2. Live byte probes (UA + per-host Referer, the exact app headers):
   - realbooru full image (hash scraped live from the list page): HTTP 200
   - hgoon.booru.org full image (thumbs.booru.org host): HTTP 200
   - gelbooru DAPI json probe: empty body from this egress IP (cloud/DC IP
     — the app runs on the player's residential IP; not a repo defect).
     List page also empty. Noted, no code change.
3. Merge name `a b` (space = booru AND) is consumed by fetchFeed via
   fetchPosts({tags: first}) -> queryVariants ladder (booru.ts:339,
   main.cjs:768) — merged 2-word tags land on the proven top-2 rung.
4. Chrome over the click target: IdleOverlay.tsx has 5 `text-` runs total,
   slim bar by design. No pollution to remove.
5. FEED list TTL 10min (imageCache.cjs:18) + queryVariants rotation intact —
   the 24h-list starvation trap stays fixed.

## Skipped (YAGNI, with reason)

- "Sources offline despite cache" empty-refill patch: rotation + ladder make
  starvation unreachable now (finding 5); add if a real starve log appears.
- gelbooru re-probe: needs residential egress; covered by app-in-user-hands.
