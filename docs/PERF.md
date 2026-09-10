# gMatch — memory & cache checkup (2026-09-10)

Posture: measure first, change only what the data justifies (ponytail).

## Baseline (Playwright `e2e/perf.spec.ts`, chromium, seeded app, 60 clicks + feed/games churn)

- JS heap: **40.1 MiB flat** across the whole run, 40.1 MiB after forced GC.
  Verdict: no renderer leak signature (detached nodes would show growth +
  retained-after-GC mass). Tripwires in the spec: growth < 60 MiB, post-GC < 120 MiB.

## Changes made (measured/evidence-driven)

1. **Electron image LRU budget 256MB → 96MB** (`electron/imageCacheMemory.cjs`).
   Rationale: one feed page ≈ 20 images × ~300KB; 96MB keeps the working set
   while capping the worst case at what a scrollback-heavy session can
   plausibly re-touch. Regression tests added (400×1MB storm stays inside the
   default budget; oldest evicted first). Revert knob: one constant.
2. **Feed-query memo 100 → 40** (`electron/imageCache.cjs FEED_MAX_QUERIES`).
   Prune path already existed and was untested; new test `electron/imageCache.test.cjs`
   (RED before the constant change) proves eviction order.
3. **Pollers respect window-hidden** (pattern already enforced at App.tsx:2352
   heartbeat/sync/offers — extended to the remaining network pollers):
   - App.tsx pollHacks 8s — skips fetch while `document.hidden`.
   - BabecockPanel 4s refresh — clock stays, 3-fetch round skipped while hidden.
   - HackSpyView 15s spy-feed poll — skipped while hidden.
   Idle game tick (1s) + save (10s) deliberately NOT gated: offline accrual is
   the product and data safety beats RAM.
4. **Blob-URL leak fixes** (audit table below):
   - IdleOverlay: slideshow blobs revoked on unmount AND on cancelled-load.
   - BabecockPanel canvas composition: per-entry blobs revoked after drawImage.
   - SendPanel: previewUrl revoked when replaced; drag-payload blob revoked on
     a 10s timer (gesture-scoped, no cross-component dance).

## Audit clean — left alone deliberately

- `src/utils/api.ts` response cache: TTL 3s × 80 entries, identity-scoped key,
  prune on both expiry and size. Economical already.
- `inflightRequests`: deleted on settle paths (verified by the same code read).
- Blob audit (create vs revoke, all 15 renderer files):
  | file | create | revoke | verdict |
  |---|---|---|---|
  | App.tsx | 5 | 10 | paired |
  | AttachmentUploadModal | 1 | 0 | preview lives in state, modal-scoped, GC'd with component — blob replaced on next pick; accepted (video preview only) |
  | CreatePostModal | 1 | 0 | handoff: previewUrl becomes the post's image until server reconcile — revoking would blank the just-posted card |
  | MatchCardUpload | 1 | 2 | paired |
  | CardZoom/CreateCard/Identity/ImageViewer/LegalCenter/SnapshotSection/useCropper | 1 | ≥1 | paired |
  | ProfilePicModal | 2 | 0 | crop flow replaces preview with dataURL before save; blob only transient; accepted |
- BabecockPanel:195 / AttachmentUploadModal:78 video previews — modal-lifetime
  blobs, freed when the modal unmounts (React drops the reference; browser
  revokes at document unload) — low-frequency surfaces, no action.
- **Server (`apps/api`)**: mail-store (TTL+caps), signal-store (5-min offers,
  single `ensureSweep` guard — confirmed), cleanup.ts 60s sweep prunes
  envelopes/stories/notifications(48h)/archive(14d). Bounded by design.
- Admin tabs 15s polls: admin view is transient; skipped (YAGNI).

## Repo housekeeping

- Purged ~600MB regenerable artifacts: old portable exes (1.0.0/1.0.1/1.1.0)
  in apps/desktop/release, asar-check extraction, win-unpacked; 34 stray
  test-blobs-* dirs at I:/ root. site/releases keeps ONLY the published
  gMatch exe (it ships in the fly image).

## Re-measure (post-change)

Run: `cd apps/desktop && npx playwright test perf --reporter=line`
Expected: same flat ~40MiB (renderer changes were revoke-timing only).
