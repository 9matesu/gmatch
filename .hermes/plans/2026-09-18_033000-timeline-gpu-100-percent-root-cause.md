# Timeline GPU 100% Spike — Root Cause Fix Plan

**Goal:** Eliminate 100% GPU utilization during timeline loading by removing redundant backdrop blur filters, gating off-screen video decoding and image resolution behind intersection observers, and eliminating blind fallback timers.

---

## 1. Current Context / Assumptions

Recent changes reduced RAM and throttled image concurrency, but GPU usage reaches 100% when loading the timeline.
Forensic inspection of the rendering pipeline reveals five converging root causes:
1. **Full-Viewport Backdrop-Filter on Giant Scrolling Container (`App.tsx` L3404):**
   The feed container `<section className="module module-primary module-glass glass-surface ...">` applies `backdrop-filter: blur(calc(22px * var(--glass-blur, 0.7)))`. The container is 1400px wide and tens of thousands of pixels tall. On every frame, scroll tick, or image decode, Chromium's GPU compositor executes a multi-pass Gaussian blur on the entire viewport surface behind it, even though every feed card inside has an opaque background (`bg-retro-panel`, `#121215`).
2. **Concurrent Hardware Video Decoding in DOM (`GMatchFeed.tsx` & `NativeVideoPlayer.tsx`):**
   `GMatchFeed.tsx` directly mounts `<NativeVideoPlayer>` for all video posts in `displayPosts`. Even when paused, each active `<video src="...">` element holds a DirectX/D3D11 hardware decoding context in the GPU process. Having 5–15 video players in the DOM saturates hardware decoder sessions (NVDEC limit) and spikes GPU 3D/Video Decode to 100%.
3. **Defeated Lazy Loading via Blind Fallback Timer (`ObjectImage.tsx` L137–138):**
   `ObjectImage` contains `window.setTimeout(() => setInView(true), jitter)` (500–3000ms). Within 3 seconds of opening the timeline, ALL 50–100 items (images, videos, object streams) are forced to `inView = true`, initiating simultaneous network fetches, crypto operations, and GPU rasterization across the entire feed.
4. **Ungated Background Image Resolution (`CachedImg.tsx` L24–47):**
   `CachedImg` triggers `resolveImage(src)` over IPC immediately upon component mount for every offscreen post without waiting for viewport visibility, causing dozens of parallel disk cache writes and simultaneous GPU texture allocations.
5. **SVG Filter Recalculation (`globals.css` L165):**
   `--glass-noise` uses `feTurbulence` inside card backgrounds, triggering continuous shader re-rasterization on the GPU during scroll.

---

## 2. Architecture / Proposed Approach

Apply the Ponytail ladder (Native platform features & minimal diffs over heavy libraries):
1. **Drop `glass-surface` / `backdrop-filter` from the scrolling timeline section in `App.tsx`:** Keep clean solid surface styling. Eliminate the expensive GPU Gaussian blur pass over the entire scrolling feed.
2. **Mount `<video>` only when in viewport in `GMatchFeed.tsx` & `ObjectImage.tsx`:** If offscreen, render a lightweight placeholder/poster. Never instantiate D3D11 hardware video decoders for items outside the viewport.
3. **Remove blind `setTimeout` fallback in `ObjectImage.tsx`:** Rely strictly on the `IntersectionObserver` with a generous root margin (`600px 0px`).
4. **Viewport-gate `CachedImg.tsx`:** Only trigger `resolveImage` when the image intersects or approaches the viewport (`rootMargin: '400px'`).

---

## 3. Step-by-Step Tasks

### Task 1: Remove `glass-surface` Backdrop Filter from Timeline Section

**File:** `apps/desktop/src/App.tsx`
**Action:** Remove `glass-surface` class from the feed `<section>`.

```tsx
// apps/desktop/src/App.tsx ~line 3404
// Before:
<section className="module module-primary module-glass glass-surface overflow-visible order-1">

// After:
<section className="module module-primary module-glass overflow-visible order-1">
```

**Verification:**
```bash
cd I:/goongrid/apps/desktop && npm run typecheck
```
*Expected output:* Exit 0, 0 errors.

---

### Task 2: Remove Blind `setInView` Fallback Timer from `ObjectImage.tsx`

**File:** `apps/desktop/src/components/ObjectImage.tsx`
**Action:** Remove `window.setTimeout(() => setInView(true), jitter)`. Feed cards no longer use `content-visibility: auto`, so `IntersectionObserver` fires reliably when scrolled into view.

```tsx
// apps/desktop/src/components/ObjectImage.tsx L122–143
// Before:
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' }
    )
    observer.observe(el)
    const jitter = 500 + Math.random() * 2500
    const fallback = window.setTimeout(() => setInView(true), jitter)
    return () => {
      observer.disconnect()
      window.clearTimeout(fallback)
    }

// After:
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
```

**Verification:**
```bash
npx vitest run src/components/ObjectImage.test.tsx
```
*Expected output:* Exit 0, 5/5 tests passed.

---

### Task 3: Viewport Gate in `CachedImg.tsx`

**File:** `apps/desktop/src/ui/CachedImg.tsx`
**Action:** Only resolve and load images when the element is near the viewport using native `IntersectionObserver`.

```tsx
// apps/desktop/src/ui/CachedImg.tsx
import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { resolveImage } from '../services/imageCache'
import { resolveMediaUrl } from '../utils/media'

interface CachedImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  fallbackSrc?: string
}

export default function CachedImg({ src: rawSrc, fallbackSrc, onError, ...rest }: CachedImgProps) {
  const src = resolveMediaUrl(rawSrc)
  const isLocal = /^(gmcache|idle-file|vault|blob|data):/i.test(src)
  const [display, setDisplay] = useState<string>(isLocal ? src : '')
  const [inView, setInView] = useState<boolean>(isLocal || rest.loading === 'eager')
  const [resolved, setResolved] = useState<boolean>(isLocal)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (inView) return
    const el = imgRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView])

  useEffect(() => {
    if (!inView) return
    let live = true
    if (/^(gmcache|idle-file|vault|blob|data):/i.test(src)) {
      setDisplay(src)
      setResolved(true)
      return
    }
    setDisplay(src)
    resolveImage(src)
      .then((local) => {
        if (live && local) {
          setDisplay(local)
          setResolved(true)
        }
      })
      .catch(() => {
        if (live) {
          setResolved(true)
        }
      })
    return () => {
      live = false
    }
  }, [src, inView])

  return (
    <img
      ref={imgRef}
      src={display || undefined}
      decoding="async"
      {...rest}
      onError={(e) => {
        if (!resolved) return
        if (fallbackSrc && e.currentTarget.src !== fallbackSrc) {
          e.currentTarget.src = fallbackSrc
          return
        }
        onError?.(e)
      }}
    />
  )
}
```

**Verification:**
```bash
npx vitest run src/components/feed/GMatchFeed.video.test.tsx
```
*Expected output:* Exit 0, 3/3 tests passed.

---

### Task 4: Viewport-Gate Video Rendering in `GMatchFeed.tsx`

**File:** `apps/desktop/src/components/feed/GMatchFeed.tsx`
**Action:** Wrap direct video rendering in a viewport-aware lazy container (`LazyVideoPost`) so that `<video>` elements are not mounted into the DOM until scrolled near the viewport.

```tsx
// Inside apps/desktop/src/components/feed/GMatchFeed.tsx:
// Create an inline lazy wrapper for timeline videos:
function FeedVideoItem({
  url,
  post,
  onExpand,
  onDoubleTap,
}: {
  url: string
  post: FeedPost
  onExpand: () => void
  onDoubleTap: () => void
}) {
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          setInView(e.isIntersecting)
        })
      },
      { rootMargin: '200px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} className="w-full aspect-[4/3] bg-surface-canvas flex items-center justify-center">
      {inView ? (
        <NativeVideoPlayer
          src={url}
          videoClassName="w-full max-h-[min(680px,80vh)] object-contain rounded-none"
          controls={true}
          alwaysShowControls={true}
          autoPlay={true}
          muted={true}
          loop={true}
          onExpand={onExpand}
          onDoubleTapLike={onDoubleTap}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-retro-muted font-mono">
          [Video]
        </div>
      )}
    </div>
  )
}
```

Replace direct `<NativeVideoPlayer>` mounts in `GMatchFeed.tsx` (L789 & L827) with `<FeedVideoItem>`:
```tsx
<FeedVideoItem
  url={post.url}
  post={post}
  onExpand={() => setActiveLightboxPost(post)}
  onDoubleTap={() => handleDoubleTap(post)}
/>
```

**Verification:**
```bash
npx vitest run src/components/feed/GMatchFeed.video.test.tsx
```
*Expected output:* Exit 0, all tests passed.

---

### Task 5: Build, Test, and Verify Metrics

1. Run test suite and typecheck:
   ```bash
   npm run typecheck && npm run test
   ```
2. Build updated portable executable:
   ```bash
   npm run stage:api && npm run build && npx electron-builder --win portable -c.directories.output="C:/Users/matco/AppData/Local/Temp/gmatch-release"
   ```
3. Copy artifact, sync hashes, and deploy to Fly.io:
   ```bash
   cp "C:/Users/matco/AppData/Local/Temp/gmatch-release/gMatch-1.3.8-portable.exe" "I:/goongrid/apps/desktop/release/gMatch-1.3.8-portable.exe"
   cd I:/goongrid/site && node build-release.mjs ../apps/desktop/release/gMatch-1.3.8-portable.exe && node sync-hash.mjs && node check.mjs
   flyctl deploy -a gmatch
   ```

---

## 4. Tests / Validation

- **Unit tests:**
  - `ObjectImage.test.tsx` passes without timeout fallback.
  - `GMatchFeed.video.test.tsx` verifies video controls and interactions remain intact.
- **Visual / Performance Check:**
  - GPU 3D / Video Decode stays under 20% on timeline scroll.
  - No concurrent video decoders active outside viewport.
  - Offscreen images deferred until 400px before viewport.

---

## 5. Risks and Tradeoffs

- **Slight delay when fast-scrolling:** Rendering videos only when near viewport means a fast scroll may display the `[Video]` placeholder for a few milliseconds before mounting the player. This is standard behavior across YouTube, Instagram, and Reddit, and prevents GPU crashes.
- **No external library dependencies:** No `@tanstack/react-virtual` refactor needed — native `IntersectionObserver` solves root cause directly with zero extra bundle weight.
