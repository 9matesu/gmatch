# Plan: Fix .exe generation + 4 UI/media bugs in gMatch

## Goal

Fix the portable `.exe` build pipeline, enable MP4 repost from Vault to feed, fix Stories black screens, center-align timeline username with avatar, and eliminate all "Unknown User" cards from the Electron desktop view.

## Current context / assumptions

- Repo root: `I:/goongrid`. Desktop app: `apps/desktop/`. API: `apps/api/`.
- Build pipeline (`npm run dist`): `make-icon` → `stage-api` (bun bundle) → `vite build` → `electron-builder --win portable`.
- Known Orca file-lock pitfall: Orca locks `default_app.asar` during packaging causing `EBUSY`. Skill prescribes temp output dir workaround.
- `stage-api.cjs` bundles API into `I:/goongrid/api-stage/` via `bun build --target=bun`, copies `bun.exe` + schema + migrations.
- Commit `bf1db69` already attempted timeline alignment fix (added `h-8` to name container). User reports it's still broken — the `leading-snug` was removed but vertical centering against the 32px avatar is still off.
- Commit `d83529d` added a DB cleanup script for Unknown User cards. The client-side filter at `App.tsx:3125-3126` rejects `display_name === 'Unknown User'` items but only for p2p objects — cards from the API with null owner names still render.
- Stories use `ObjectImage` (line 491-499 of `GMatchStories.tsx`) which delegates video to `<video>` or `NativeVideoPlayer`. Black screen = video src not resolving or MIME type missing.
- Vault MP4 repost: commit `202592e` added HTTP URL resolution for vault videos but the feed post creation flow may not pass the resolved URL through.

## Architecture / proposed approach

Five independent fixes touching six files total. Each fix targets the root cause, not the symptom. The `.exe` build fix is procedural (temp dir + cleanup). The media/UI fixes are one-to-three-line patches each. No new dependencies, no new abstractions.

## Step-by-step tasks

### Task 1: Fix .exe generation — Orca EBUSY workaround

**File:** `apps/desktop/package.json` (lines 76-78)

The `build.directories.output` is `"release"` which sits inside Orca's watch tree. Change it to a temp path, build, copy back, revert.

1. Patch `apps/desktop/package.json`:
```json
"directories": {
  "output": "C:/Users/matco/AppData/Local/Temp/gmatch-release",
  "buildResources": "build"
}
```

2. Run build from `apps/desktop/`:
```bash
cd I:/goongrid/apps/desktop && npm run dist 2>&1 | tee $LOCALAPPDATA/Temp/gmatch-build.log
```
Expected: exit code 0, file exists at `C:/Users/matco/AppData/Local/Temp/gmatch-release/gMatch-1.4.3-portable.exe`.

3. Copy result:
```bash
mkdir -p I:/goongrid/apps/desktop/release && cp "$LOCALAPPDATA/Temp/gmatch-release/gMatch-1.4.3-portable.exe" I:/goongrid/apps/desktop/release/
```

4. Revert `package.json` output back to `"release"`.

5. Cleanup stale exes:
```bash
rm -f I:/goongrid/*.exe I:/tmp/gMatch-*.exe
rm -rf I:/goongrid/apps/desktop/release/win-unpacked*
```

**Verification:** `ls -la I:/goongrid/apps/desktop/release/gMatch-1.4.3-portable.exe` shows ~110MB file.

### Task 2: Fix MP4 Vault repost not appearing on feed

**Root cause:** When user clicks "repost" on a vault-pinned MP4, the share modal creates a post with the original `vault://` or `gmatch-vault://` scheme URL. The feed renderer's `ObjectImage` doesn't handle vault scheme URLs — it needs an HTTP URL served by the local API.

**Files to inspect then patch:**
- `apps/desktop/src/components/feed/SharePostModal.tsx` — where repost URL is set
- `apps/desktop/src/services/vault.ts` — `vaultHttpUrl()` already converts vault:// to http://localhost:... 

1. Read `SharePostModal.tsx` to find where `content_url` is assigned for reposts.
2. If the URL starts with `gmatch-vault://` or `vault://`, resolve it through `vaultHttpUrl()` before submitting the post.

Patch pattern (exact code depends on read):
```typescript
import { vaultHttpUrl } from '../../services/vault'

// In the repost submit handler, before creating the post:
let finalUrl = item.content_url || ''
if (/^(gmatch-)?vault:\/\//i.test(finalUrl)) {
  const http = await vaultHttpUrl(finalUrl)
  if (http) finalUrl = http
}
```

**Verification:** Repost an MP4 from Vault → open feed → the post should show a playing video, not blank/error.

### Task 3: Fix Stories showing black screens

**Root cause:** `GMatchStories.tsx` line 491-499 passes `currentStory.mime_type` to `ObjectImage`. For vault-stored videos or booru MP4s, `mime_type` may be null/undefined, so `ObjectImage` falls through to `<img>` instead of `<video>`, resulting in black screen.

**File:** `apps/desktop/src/components/GMatchStories.tsx` (line 495)

1. Add video MIME inference from URL when `mime_type` is absent:

```typescript
import { isMediaVideo } from '../utils/media'

// Line 495 area — change mimeType prop:
mimeType={currentStory.mime_type || (isMediaVideo(currentStory.content_url) ? 'video/mp4' : undefined)}
```

2. Also ensure `ObjectImage` receives the vault-resolved URL. If `currentStory.content_url` is a vault scheme, resolve it first using `useVaultUrl` or inline resolution. Check if `ObjectImage` already handles this via its `useVaultUrl` hook (line 163 of ObjectImage.tsx — it does for `http(s):` URLs but NOT for vault scheme URLs).

If stories store vault:// URLs, add resolution before passing to ObjectImage:
```typescript
const storyUrl = useVaultUrl(currentStory.content_url) || currentStory.content_url
// Pass storyUrl as contentUrl to ObjectImage
```

**Verification:** Open a story containing an MP4 → video plays, no black screen.

### Task 4: Fix username alignment on timeline

**Root cause:** The avatar is `w-8 h-8` (32px). The name container at `GMatchFeed.tsx:774` has `h-8 flex flex-col justify-center` (from commit bf1db69) but the inner text elements have conflicting line-heights causing visual top-alignment.

**File:** `apps/desktop/src/components/feed/GMatchFeed.tsx` (lines 774-792)

Current code (after bf1db69):
```tsx
<div className="h-8 flex flex-col justify-center min-w-0">
  <div className="flex items-center gap-1.5">
    <span className="text-xs font-semibold text-retro-fg hover:underline cursor-pointer truncate leading-tight block">
      {post.author_name}
    </span>
  </div>
  <div className="flex items-center gap-1 text-[11px] text-retro-muted leading-tight mt-0.5 truncate">
    ...
  </div>
</div>
```

The problem: `justify-center` on `h-8` should work, but the outer flex parent (line 757-759) uses `items-center` which constrains children. The name block needs to be truly vertically centered against the avatar.

Fix — replace lines 774-792:
```tsx
<div className="flex flex-col justify-center min-w-0 self-center">
  <div className="flex items-center gap-1.5 leading-none">
    <span
      role="button"
      tabIndex={0}
      onClick={() => handleNameClick(post.author_id)}
      onKeyDown={(e) => e.key === 'Enter' && handleNameClick(post.author_id)}
      className="text-xs font-semibold text-retro-fg hover:underline cursor-pointer truncate block"
    >
      {post.author_name}
    </span>
  </div>
  <div className="flex items-center gap-1 text-[11px] text-retro-muted leading-none mt-0.5 truncate">
    {post.location ? (
      <span className="truncate">{post.location}</span>
    ) : (
      <time dateTime={post.created_at}>
        {new Date(post.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
      </time>
    )}
  </div>
</div>
```

Key changes: removed fixed `h-8`, added `self-center` to vertically center the text block against the avatar within the parent `items-center` flex row. Changed `leading-tight` to `leading-none` to prevent line-height pushing text down.

**Verification:** Timeline posts show username text vertically centered next to the circular avatar.

### Task 5: Eliminate "Unknown User" cards in Electron desktop

**Root cause:** `CardTile.tsx:81-85` falls back to `'Unknown User'` when no name is found. Cards from the API that have no matching user record display this string. The App.tsx filter at line 3125-3126 only filters p2p objects, not regular cards.

**Two-part fix:**

#### Part A: Filter out cards with no resolvable owner at the data layer

**File:** `apps/desktop/src/App.tsx` (around line 3125)

Current filter:
```typescript
if ((item.id.startsWith('p2p-obj-') || item.display_name === 'Unknown User') && !canonicalCards.some(c => c.mediaObjectId === item.id)) return false
```

This only catches p2p items. Extend to catch ALL items with no real owner:
```typescript
// Filter items that have no resolvable display name (not just p2p)
const resolvedName = item.display_name?.trim() || item.owner_name?.trim() || users.find((u: any) => u.id === item.owner_id)?.display_name?.trim()
if (!resolvedName && !canonicalCards.some(c => c.mediaObjectId === item.id)) return false
```

#### Part B: Never render "Unknown User" as fallback text in CardTile

**File:** `apps/desktop/src/components/home/CardTile.tsx` (lines 81-85)

Change:
```typescript
const ownerLabel = (
  item.owner_name?.trim() || item.uploader_name?.trim() ||
  users?.find(u => u.id === item.owner_id)?.display_name?.trim() ||
  'Unknown User'
)
```

To:
```typescript
const ownerLabel = (
  item.owner_name?.trim() || item.uploader_name?.trim() ||
  users?.find(u => u.id === item.owner_id)?.display_name?.trim() ||
  ''
)
```

And update line 87:
```typescript
const cardTitle = item.name?.trim() || item.caption?.trim() || ownerLabel || 'Untitled'
```

Then in the JSX footer (line 249-265), hide the "by" section when no owner:
```tsx
{ownerLabel && (
  <span className="truncate">
    by{' '}
    {onOpenOwnerProfile ? (
      <button ...>{ownerLabel}</button>
    ) : (
      <span className="font-medium text-retro-fg">{ownerLabel}</span>
    )}
  </span>
)}
```

**Verification:** Browse cards grid in Electron — zero cards display "Unknown User". Cards without owners show only the image and "Untitled" title.

## Tests / validation

Run after all patches:
```bash
cd I:/goongrid/apps/desktop
npm run lint
# Expected: 0 errors
npm run test
# Expected: all existing tests pass
npm run typecheck
# Expected: no type errors
```

For the `.exe` build: verify the output binary launches and shows the app without errors.

## Risks, tradeoffs, and open questions

- **Task 1 (Orca lock):** If Orca also watches `$LOCALAPPDATA/Temp`, the build will still fail. Mitigation: use `C:/Users/matco/AppData/Local/Temp/gmatch-release` specifically (outside typical project watchers).
- **Task 2 (Vault repost):** Need to read `SharePostModal.tsx` to confirm exact variable names. The fix pattern is correct but field names may differ.
- **Task 3 (Stories black screen):** If the issue is codec-level (Electron's bundled Chromium doesn't support the MP4 codec), no CSS/JS fix helps — would need transcoding. Unlikely given other videos work.
- **Task 5 (Unknown User filtering):** Removing the `'Unknown User'` fallback means some cards render with empty owner fields. This is intentional per user request ("ensure there is NONE of that"). Cards with truly no owner data should ideally not exist in the DB — the `scripts/db-cleanup.mjs` handles that separately.