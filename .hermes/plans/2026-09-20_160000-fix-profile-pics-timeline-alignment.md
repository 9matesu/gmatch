# Fix Profile Pictures & Timeline Username Alignment

## Goal
Fix profile picture upload, persistence, and cross-user visibility by storing sanitized data URLs directly in `Users.pfp_url` (eliminating broken zero-media P2P redirects), and vertically align the post author header with the 32px avatar on the timeline.

## Current Context / Assumptions
1. `saveUserProfile` (`apps/desktop/src/utils/profile.ts`) intercepts any `data:image/` URL with length > 3072 bytes via `uploadAvatarBytes`, converting it into an `/api/objects/<uuid>` registered via `forgeMediaLocally`.
2. `forgeMediaLocally` is zero-media P2P: it never sends binary bytes to Fly.io, storing only magnet metadata.
3. When `GET /api/objects/<uuid>` is called, it returns `Content-Type: application/json` (`{ type: 'p2p', ... }`). Standard browser `<img>` tags cannot render JSON, trigger `onError`, and collapse to identicons.
4. `Users.pfp_url` stored as `/api/objects/<uuid>` causes `GET /api/users/:id/pfp` to 404 and prevents all peers from viewing avatars.
5. In `apps/desktop/src/components/feed/GMatchFeed.tsx`, the post header author container lacks fixed height and consistent line-height relative to the `w-8 h-8` (32px) circular avatar, causing visual vertical misalignment ("too on top").
6. Residual tonal `playWin()` SFX calls remain in `ProfilePicModal.tsx` and `ProfileEditorModal.tsx`.

## Architecture / Proposed Approach
- Remove the `uploadAvatarBytes` interceptor in `apps/desktop/src/utils/profile.ts`; send the compact 256x256 thumbnail data URL directly in `PATCH /api/users/profile`. The server already strips EXIF via `stripImageMetadata` and stores the data URL in `Users.pfp_url`.
- In `apps/desktop/src/App.tsx`, ensure `loadServerFeed` seeds `profilePics` from `post.author_avatar`, and `Avatar.tsx` safely falls back if encountering a legacy broken `/api/objects/` avatar ref.
- In `apps/desktop/src/components/feed/GMatchFeed.tsx`, structure the author header as a dedicated `h-8 flex flex-col justify-center min-w-0` block matching the 32px avatar height: line 1 displays the author name, line 2 displays the location (if present) or formatted timestamp.

---

## Step-by-Step Tasks

### Task 1: Pass Base64 Data URL Directly in `saveUserProfile`
- **File**: `apps/desktop/src/utils/profile.ts`
- **Action**: Remove `uploadAvatarBytes` and the `body.pfp_url.length > 3072` check. Allow base64 data URLs to pass directly into `PATCH /api/users/profile`.
- **Code**:
```typescript
// apps/desktop/src/utils/profile.ts
// Remove uploadAvatarBytes completely.

export async function saveUserProfile(
  identity: OrbitIdentity,
  patch: ProfilePatch,
): Promise<{ ok: boolean; status: number; error?: string; pfpUrl?: string }> {
  const body: ProfilePatch = { ...patch };
  if (body.tags !== undefined) body.tags = normalizeTags(body.tags as (string | null | undefined)[]);

  const res = await orbitFetch('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, identity);
  let error: string | undefined;
  if (res.ok) {
    invalidateCache('/api/users');
  } else {
    try {
      const data = await res.json();
      error = data?.error || data?.message;
    } catch {
      error = `Profile save failed (HTTP ${res.status})`;
    }
  }
  let pfpUrl: string | undefined;
  if (res.ok && body.pfp_url !== undefined) {
    try {
      const json = await res.json();
      pfpUrl = (json as { pfp_url?: string })?.pfp_url ?? undefined;
    } catch { /* keep optimistic */ }
  }
  return { ok: res.ok, status: res.status, error, pfpUrl };
}
```
- **Verification**: Run Vitest on `apps/desktop/src/utils/profile.test.ts`.

---

### Task 2: Update Profile Tests for Realistic Data URLs
- **File**: `apps/desktop/src/utils/profile.test.ts`
- **Action**: Add a test verifying that large data URLs (> 3072 bytes) are preserved in the PATCH body without being rewritten.
- **Code**:
```typescript
// apps/desktop/src/utils/profile.test.ts
it('preserves data URL avatars exceeding 3KB without rewriting', async () => {
  apiMock.orbitFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pfp_url: 'data:image/jpeg;base64,' + 'A'.repeat(5000) }) });
  const largeDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
  const res = await saveUserProfile(identity, {
    display_name: 'Test User',
    pfp_url: largeDataUrl,
  });
  expect(res.ok).toBe(true);
  const [, init] = apiMock.orbitFetch.mock.calls[0];
  expect(JSON.parse(init.body).pfp_url).toBe(largeDataUrl);
});
```
- **Command**: `npx vitest run src/utils/profile.test.ts`
- **Expected Output**: All tests pass.

---

### Task 3: Replace Tonal SFX in Profile Modals
- **Files**:
  - `apps/desktop/src/components/profile/ProfilePicModal.tsx`
  - `apps/desktop/src/components/profile/ProfileEditorModal.tsx`
- **Action**: Replace `playWin()` with `playPress(800)` upon saving profile picture or updating profile.
- **Code**:
In `ProfilePicModal.tsx`:
```typescript
// Line 125
playPress(800);
onSave(finalUrl);
```
In `ProfileEditorModal.tsx`:
```typescript
// Line 127
playPress(800);
toast?.('Profile updated', 'success');
```
- **Command**: `npm run typecheck` in `apps/desktop`
- **Expected Output**: Exit code 0, 0 errors.

---

### Task 4: Enhance Avatar Fallback in `Avatar.tsx` and Alias `/avatar` in API
- **Files**:
  - `apps/desktop/src/components/Avatar.tsx`
  - `apps/api/src/routes/users.ts`
- **Action**:
  1. In `apps/desktop/src/components/Avatar.tsx`, if `imageUrl` starts with `/api/objects/` or is a raw UUID (stale metadata-only ref), do not attempt to load it as an image; fallback to `/api/users/${id}/pfp` or identicon.
  2. In `apps/api/src/routes/users.ts`, add route `users.get('/:id/avatar', ...)` aliasing `users.get('/:id/pfp', ...)`.
- **Code**:
In `apps/desktop/src/components/Avatar.tsx`:
```typescript
// apps/desktop/src/components/Avatar.tsx
useEffect(() => {
  if (!imageUrl) {
    setCachedUrl(null);
    return;
  }
  // Stale P2P object refs return JSON metadata, not image bytes — route to user pfp endpoint
  let targetUrl = imageUrl;
  if (targetUrl.includes('/api/objects/') && id) {
    targetUrl = `/api/users/${id}/pfp`;
  }
  const resolved = resolveMediaUrl(targetUrl);
  if (/^(gmcache|idle-file|vault|blob|data):/i.test(resolved)) {
    setCachedUrl(resolved);
    return;
  }
  const proxied = devFetchable(resolved);
  if (proxied) {
    setCachedUrl(proxied);
    return;
  }
  let live = true;
  resolveImage(resolved).then((local) => {
    if (live && local && local !== resolved) setCachedUrl(local);
  }).catch(() => {});
  return () => { live = false; };
}, [imageUrl, id]);
```
In `apps/api/src/routes/users.ts`:
```typescript
// apps/api/src/routes/users.ts
// Add alias for /avatar alongside /pfp
users.get('/:id/avatar', async (c) => {
  const userId = c.req.param('id');
  return c.redirect(`/api/users/${userId}/pfp`, 307);
});
```
- **Command**: `npm run typecheck` in `apps/desktop` and `apps/api`
- **Expected Output**: Exit code 0.

---

### Task 5: Align Timeline Username & Header Typography in `GMatchFeed.tsx`
- **File**: `apps/desktop/src/components/feed/GMatchFeed.tsx`
- **Action**: Replace the unconstrained author text container with an `h-8 flex flex-col justify-center min-w-0` block that matches the 32px (`w-8 h-8`) avatar circle. Present author name on line 1 and metadata (location or timestamp) on line 2.
- **Code**:
```tsx
{/* Post Header */}
<div className="flex items-center justify-between px-3 sm:px-4 py-3">
  <div
    className="flex items-center gap-2.5 min-w-0"
    onContextMenu={(e) => onUserContext?.(e, post.author_id, post.author_name)}
  >
    <div
      role="button"
      tabIndex={0}
      onClick={() => handleAvatarClick(post.author_id)}
      onKeyDown={(e) => e.key === 'Enter' && handleAvatarClick(post.author_id)}
      title={authorHasStory ? 'Watch story' : 'View profile'}
      className={`relative w-8 h-8 rounded-full p-[1.5px] flex-shrink-0 cursor-pointer ${authorHasStory ? 'bg-gradient-to-tr from-zinc-300 to-zinc-600' : 'bg-glass-w12 border border-border-glass'}`}
    >
      <div className="relative w-full h-full rounded-full bg-retro-panel overflow-hidden flex items-center justify-center text-xs font-semibold text-retro-fg">
        <Avatar id={post.author_id} size={32} imageUrl={profilePics[post.author_id] || post.author_avatar} fill={true} />
      </div>
    </div>
    <div className="h-8 flex flex-col justify-center min-w-0">
      <div className="flex items-center gap-1.5">
        <span
          role="button"
          tabIndex={0}
          onClick={() => handleNameClick(post.author_id)}
          onKeyDown={(e) => e.key === 'Enter' && handleNameClick(post.author_id)}
          className="text-xs font-semibold text-retro-fg hover:underline cursor-pointer truncate leading-tight block"
        >
          {post.author_name}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-retro-muted leading-tight mt-0.5 truncate">
        {post.location ? (
          <span className="truncate">{post.location}</span>
        ) : (
          <time dateTime={post.created_at}>
            {new Date(post.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
          </time>
        )}
      </div>
    </div>
  </div>

  <button
    type="button"
    onClick={() => setOptionsPost(post)}
    className="text-retro-muted hover:text-retro-fg p-1.5 rounded-md cursor-pointer hover:bg-glass-w12 transition-colors shrink-0"
    aria-label="Post options"
  >
    <MoreHorizontal className="w-4 h-4" />
  </button>
</div>
```
- **Command**: `npx vitest run src/components/feed/GMatchFeed.authorClick.test.tsx`
- **Expected Output**: 2 passed.

---

### Task 6: Seed `profilePics` from Feed Posts in `App.tsx`
- **File**: `apps/desktop/src/App.tsx`
- **Action**: In `loadServerFeed`, update `profilePics` cache with any `p.author_avatar` returned by public feed posts so timeline post avatars are available immediately without waiting for `/api/users`.
- **Code**:
```typescript
// apps/desktop/src/App.tsx inside loadServerFeed
if (Array.isArray(data?.posts)) {
  setServerPosts(data.posts as FeedPost[]);
  setHasMoreFeed(data.posts.length >= 50);
  setProfilePics((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const p of data.posts as FeedPost[]) {
      if (p.author_id && p.author_avatar && next[p.author_id] !== p.author_avatar) {
        next[p.author_id] = p.author_avatar;
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}
```
- **Command**: `npm run typecheck` in `apps/desktop`
- **Expected Output**: Exit code 0, 0 errors.

---

## Tests & Validation
1. Unit tests:
   - `npx vitest run src/utils/profile.test.ts`
   - `npx vitest run src/components/feed/GMatchFeed.authorClick.test.tsx`
   - `npx vitest run src/components/Avatar.test.tsx`
2. Full test suite:
   - `npm run test` in `apps/desktop` (all test files pass)
3. Typecheck:
   - `npm run typecheck` in `apps/desktop` (0 errors)
   - `npm run typecheck` in `apps/api` (0 errors)

---

## Risks, Tradeoffs, and Open Questions
- **Risk**: Existing SQLite rows with `/api/objects/<uuid>` from earlier testing will not show an avatar until the user updates their picture or the client falls back to `/api/users/:id/pfp`.
  - **Mitigation**: `Avatar.tsx` reroutes `/api/objects/` to `/api/users/:id/pfp`, preventing broken image requests.
- **Tradeoff**: Inline data URLs in `/api/users` increase JSON payload by ~10KB per online user with custom avatar.
  - **Ceiling**: `# ponytail: inline data URL capped at 256px JPEG (~12KB); migrate to S3/R2 signed upload if concurrent active users exceed 500`.
