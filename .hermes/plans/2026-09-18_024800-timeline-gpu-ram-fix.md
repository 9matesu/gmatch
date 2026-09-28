# Plan: Timeline GPU/RAM spike fix

## Goal
Eliminate GPU and RAM spikes when scrolling the feed by capping concurrent media decoding, pausing off-screen video, and bounding the blob URL cache.

## Current context / assumptions
- Repo: `I:/goongrid`, branch `main`.
- Recent change: renderer session Map removed (`imageCache.ts`), images now stream from `gmcache://` disk cache via `diskImageCache.cjs`. This shifted load from heap to decode pipeline.
- `GMatchFeed.tsx` (1254 lines) renders all posts in a flat `.map()` with no virtualization. Each post mounts `ObjectImage` or `NativeVideoPlayer` or `CachedImg`.
- `ObjectImage.tsx` has IntersectionObserver for signed fetches but a 1500ms fallback timeout that forces `inView=true` for ALL deferred images simultaneously (line 137). Every object image decodes at once.
- `useObjectImage.ts` holds a 96-slot LRU `objectCache` Map of blob URLs. Blob URLs keep decoded frames in GPU memory until revoked. 96 slots x multi-MB images = hundreds of MB on GPU.
- `NativeVideoPlayer.tsx` (705 lines) is used in-feed with `autoPlay={true}` and `loop={true}`. No IntersectionObserver pause. Every video in the DOM plays and decodes simultaneously.
- `LazyVideo.tsx` has proper IO-based pause/unload but is only used in gallery/match tabs, not the main feed.
- `CachedImg.tsx` calls `resolveImage()` which hits the `gmcache://` protocol for every non-local URL. No concurrency limit.

## Architecture / proposed approach
Three root causes, three fixes. (1) Replace the 1500ms blanket fallback in ObjectImage with staggered decode using `img.decode()` or `content-visibility:auto` CSS already present. (2) Add IntersectionObserver-based pause to NativeVideoPlayer when used in feed context, or swap feed videos to LazyVideo. (3) Reduce useObjectImage LRU cap from 96 to 24 and revoke blob URLs aggressively so decoded GPU textures free up.

## Step-by-step tasks

### Task 1: Cap blob URL cache at 24 slots
File: `apps/desktop/src/hooks/useObjectImage.ts`
Change line 40 from `const CACHE_MAX = 96` to `const CACHE_MAX = 24`.
Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` exits 0.
Commit: `git add apps/desktop/src/hooks/useObjectImage.ts && git commit -m "perf: reduce blob URL cache from 96 to 24 slots"`

### Task 2: Remove 1500ms blanket fallback, stagger instead
File: `apps/desktop/src/components/ObjectImage.tsx`
Replace lines 136-137:
```
    // Fallback: feed cards carry [content-visibility:auto], which can suppress
    // the observer callback for skipped subtrees — lazy media then stays blank
    // until some later layout pass (the "images only load after opening the
    // idle clicker" report). Flip inView on a short grace period so deferred
    // media always resolves.
    const fallback = window.setTimeout(() => setInView(true), 1500)
```
With:
```
    // Stagger: randomize fallback between 500-3000ms so not all deferred
    // images hit the decode pipeline simultaneously.
    const delay = 500 + Math.random() * 2500
    const fallback = window.setTimeout(() => setInView(true), delay)
```
Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` exits 0.
Commit: `git add apps/desktop/src/components/ObjectImage.tsx && git commit -m "perf: stagger deferred image decode to avoid GPU spike"`

### Task 3: Pause NativeVideoPlayer when off-screen in feed
File: `apps/desktop/src/components/media/NativeVideoPlayer.tsx`
Add an IntersectionObserver effect after line 132 (after the fullscreenchange listener):
```
  // Pause playback when scrolled out of viewport to free GPU decoder.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const v = videoRef.current;
          if (!v) return;
          if (!entry.isIntersecting && !v.paused) {
            v.pause();
          } else if (entry.isIntersecting && autoPlay && v.paused) {
            v.play().catch(() => {});
          }
        });
      },
      { rootMargin: '100px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoPlay]);
```
Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` exits 0.
Run tests: `cd I:/goongrid/apps/desktop && npx vitest run src/components/media/ 2>&1 | tail -5`
Commit: `git add apps/desktop/src/components/media/NativeVideoPlayer.tsx && git commit -m "perf: pause feed videos when off-screen via IntersectionObserver"`

### Task 4: Add img decoding="async" to ObjectImage and CachedImg
File: `apps/desktop/src/components/ObjectImage.tsx`, line 223-236 (the `<img>` return).
Add `decoding="async"` attribute:
```
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
```
File: `apps/desktop/src/ui/CachedImg.tsx`, line 49-62 (the `<img>` return).
Add `decoding="async"`:
```
    <img
      src={display || undefined}
      decoding="async"
      {...rest}
```
Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` exits 0.
Commit: `git add apps/desktop/src/components/ObjectImage.tsx apps/desktop/src/ui/CachedImg.tsx && git commit -m "perf: async image decoding to avoid blocking main thread"`

### Task 5: Run full test suite
Command: `cd I:/goongrid/apps/desktop && npx vitest run 2>&1 | tail -10`
Expected: all tests pass. If failures, fix inline.

### Task 6: Build, stage, push
```
cd I:/goongrid/apps/desktop && npm run stage:api
```
Build portable exe via temp dir (same pattern as previous build):
```
rm -rf "C:/Users/matco/AppData/Local/Temp/gmatch-release" && npx electron-builder --win portable -c.directories.output="C:/Users/matco/AppData/Local/Temp/gmatch-release"
```
Copy, commit, push:
```
cp "C:/Users/matco/AppData/Local/Temp/gmatch-release/gMatch-1.3.8-portable.exe" "I:/goongrid/apps/desktop/release/gMatch-1.3.8-portable.exe"
cd I:/goongrid && git add -A && git commit -m "perf: timeline GPU/RAM optimization" && git push origin main
```
Deploy site:
```
cd I:/goongrid/site && node build-release.mjs ../apps/desktop/release/gMatch-1.3.8-portable.exe && node sync-hash.mjs
cd I:/goongrid && git add site/ && git commit -m "site: update hashes for perf build" && git push origin main
flyctl deploy -a gmatch
```

## Tests / validation
- `npx tsc --noEmit` clean after each task.
- `npx vitest run` passes after task 4.
- Manual: open app, scroll feed fast, observe Task Manager GPU/RAM stays under 300MB total.

## Risks, tradeoffs, and open questions
- CACHE_MAX=24 means more re-fetches for users who scroll back up quickly. Acceptable since disk cache serves them instantly via gmcache://.
- Staggered fallback (500-3000ms) means some images appear slightly later on first load. Tradeoff for no GPU spike.
- NativeVideoPlayer IO pause may conflict with lightbox/expansion. The `autoPlay` check in the observer guards against resuming paused-by-user videos.
- If GPU spike persists after these changes, the next step is CSS `content-visibility: auto` on feed card containers (already partially applied per comments) or react-window virtualization.
