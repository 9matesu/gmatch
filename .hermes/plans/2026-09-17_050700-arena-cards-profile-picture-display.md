# Fix Profile Picture Display on Arena Cards Implementation Plan

> **For Hermes:** Use subagent-driven-development or strict TDD to implement this plan task-by-task.

**Goal:** Ensure player profile pictures reliably render on Arena player cards and duel match headers across local self and remote players.

**Architecture:** 
1. The backend API (`apps/api/src/routes/objects.ts`) must treat objects marked `is_avatar = 1` as publicly accessible in `GET /api/objects/:id` so unauthenticated `<img>` tags never 404 on stored avatars.
2. The desktop shell (`App.tsx` → `GamesView.tsx` → `LobbyPanel.tsx`) threads `profilePics` down to the Arena lobby so the player roster resolves cached avatars alongside server-provided `pfp_url` and local storage `orbit_pfp_url` for self.
3. Arena components (`PlayerRoster.tsx` and `MatchRoundPanel.tsx`) fall back cleanly to `users` and `profilePics`, and use `resolveMediaUrl` + `<Avatar />` rather than raw `<img>` tags on relative `/api/objects/...` paths.

**Tech Stack:** React 19, TypeScript, Vitest, Hono, SQLite/D1.

---

### Task 1: Authorize `is_avatar` objects as public in `GET /api/objects/:id`

**Objective:** Allow any client (via standard `<img>` tag without auth headers) to fetch objects where `is_avatar = 1`.

**Files:**
- Modify: `apps/api/src/routes/objects.ts:480-530`
- Test: `apps/api/src/routes/objects-security.test.ts`

**Step 1: Write failing test**
In `apps/api/src/routes/objects-security.test.ts`, add a test verifying that an unauthenticated request to `GET /api/objects/:id` for an object with `is_avatar = 1` returns 200:

```ts
it('allows unauthenticated requests to GET /api/objects/:id when is_avatar = 1', async () => {
  const avatarId = 'avatar-test-uuid-1';
  await env.DB.prepare(
    "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_avatar, is_public, is_story) VALUES (?, ?, 10, 'image/jpeg', 'data:image/jpeg;base64,AAAA', 1, 0, 0)"
  ).bind(avatarId, 'owner-123').run();

  const res = await app.request(`/api/objects/${avatarId}`);
  expect(res.status).toBe(200);
});
```

**Step 2: Run test to verify failure**
Run: `npm test -w @orbit/api -- src/routes/objects-security.test.ts`
Expected: FAIL — 404 (Object not found)

**Step 3: Implement minimal change**
In `apps/api/src/routes/objects.ts`:
1. In `objects.get('/:id')`, update the query on line 484 to include `o.is_avatar`:
```ts
    row = await c.env.DB.prepare(
      'SELECT o.id, o.owner_id, o.size_bytes, o.mime_type, o.content_url, o.created_at, o.is_story, o.is_public, o.is_avatar, o.hidden_at FROM Objects o WHERE o.id = ?'
    ).bind(id).first<{ id: string; owner_id: string; size_bytes: number; mime_type: string; content_url: string | null; created_at: string; is_story: number; is_public: number; is_avatar: number; hidden_at: string | null }>()
```
2. On line 500, add `row.is_avatar !== 1`:
```ts
  if (!isSignedToken && (!orbitId || row.owner_id !== orbitId) && row.is_public !== 1 && row.is_story !== 1 && row.is_avatar !== 1
      && !isPartyMediaObject(`/api/objects/${id}`)) {
```
3. Update the avatar check on line 520 to also match `pfp_url LIKE '%/api/objects/' || ?`:
```ts
      const isAvatar = row.is_avatar === 1 || await c.env.DB.prepare(
        "SELECT 1 FROM Users WHERE (pfp_url = ? OR pfp_url LIKE '%/api/objects/' || ?) AND hidden_at IS NULL LIMIT 1",
      ).bind(`/api/objects/${id}`, id).first().catch(() => null)
```

**Step 4: Run test to verify pass**
Run: `npm test -w @orbit/api -- src/routes/objects-security.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/api/src/routes/objects.ts apps/api/src/routes/objects-security.test.ts
git commit -m "fix(api): allow unauthenticated reads for objects flagged as is_avatar"
```

---

### Task 2: Thread `profilePics` prop through `GamesView` and `LobbyPanel`

**Objective:** Give the Arena lobby access to the client's cached profile pictures (`profilePics`).

**Files:**
- Modify: `apps/desktop/src/App.tsx:3565-3595`
- Modify: `apps/desktop/src/components/views/GamesView.tsx:18-115`
- Modify: `apps/desktop/src/components/LobbyPanel.tsx:25-115`

**Step 1: Write failing test**
Create `apps/desktop/src/components/lobby/PlayerRoster.test.tsx` testing that `PlayerRoster` and `PlayerTile` render profile images when provided via `profilePics`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerRoster } from './PlayerRoster';

describe('PlayerRoster profile pictures', () => {
  it('renders profile picture from player.pfp_url', () => {
    const players = [
      {
        id: 'user-1',
        display_name: 'Alice',
        pfp_url: 'https://example.com/alice.jpg',
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    render(<PlayerRoster players={players} selfId="self-id" spectateRequesting={null} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/alice.jpg');
  });

  it('renders profile picture from profilePics map when player.pfp_url is null', () => {
    const players = [
      {
        id: 'user-2',
        display_name: 'Bob',
        pfp_url: null,
        tags: [],
        queueStatus: 'online' as const,
      },
    ];
    const profilePics = { 'user-2': 'https://example.com/bob.jpg' };
    render(<PlayerRoster players={players} selfId="self-id" spectateRequesting={null} profilePics={profilePics} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/bob.jpg');
  });
});
```

**Step 2: Run test to verify failure**
Run: `npm test -w @gmatch/desktop -- src/components/lobby/PlayerRoster.test.tsx`
Expected: FAIL — `profilePics` prop not recognized on `PlayerRoster`

**Step 3: Implement minimal change**
1. In `apps/desktop/src/components/lobby/PlayerRoster.tsx`:
   - Add `profilePics?: Record<string, string>` to `PlayerRosterProps`.
   - Pass `profilePics` into `PlayerTile` and `DuelPair`.
   - In `PlayerTile`, determine `imageUrl`:
     ```tsx
     const base = users?.find(u => u.id === player.id);
     const localSelfPfp = player.id === selfId && typeof window !== 'undefined'
       ? (localStorage.getItem('orbit_pfp_url') || '')
       : '';
     const effectivePfp = player.pfp_url || base?.pfp_url || profilePics?.[player.id] || localSelfPfp || undefined;
     ```
   - Pass `imageUrl={effectivePfp}` to `<Avatar id={player.id} imageUrl={effectivePfp} fill />`.

2. In `apps/desktop/src/components/LobbyPanel.tsx`:
   - Add `profilePics?: Record<string, string>` to `Props`.
   - Update `resolvePfp`:
     ```tsx
     const resolvePfp = (id: string, directPfp?: string | null): string | null => {
       if (directPfp) return directPfp;
       const fromUsers = usersMap.get(id)?.pfp_url;
       if (fromUsers) return fromUsers;
       if (profilePics?.[id]) return profilePics[id];
       if (id === selfId && typeof window !== 'undefined') {
         try {
           const local = localStorage.getItem('orbit_pfp_url');
           if (local && local.trim()) return local;
         } catch { }
       }
       return null;
     };
     ```
   - Pass `profilePics={profilePics}` to `<PlayerRoster ... />`.

3. In `apps/desktop/src/components/views/GamesView.tsx`:
   - Add `profilePics?: Record<string, string>` to `GamesView` props.
   - Forward `profilePics={profilePics}` to `<LobbyPanel ... />`.

4. In `apps/desktop/src/App.tsx`:
   - Pass `profilePics={profilePics}` to `<GamesView ... />`.

**Step 4: Run test to verify pass**
Run: `npm test -w @gmatch/desktop -- src/components/lobby/PlayerRoster.test.tsx`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/desktop/src/components/lobby/PlayerRoster.tsx apps/desktop/src/components/lobby/PlayerRoster.test.tsx apps/desktop/src/components/LobbyPanel.tsx apps/desktop/src/components/views/GamesView.tsx apps/desktop/src/App.tsx
git commit -m "feat(desktop): thread profilePics and local storage pfp fallback to arena player cards"
```

---

### Task 3: Fix Opponent Avatar in `MatchRoundPanel`

**Objective:** Render opponent profile picture correctly during live arena duels using `resolveMediaUrl` and `<Avatar />`.

**Files:**
- Modify: `apps/desktop/src/components/MatchRoundPanel.tsx:235-255`
- Modify: `apps/desktop/src/components/LobbyPanel.tsx:400-420`

**Step 1: Write failing test**
In `apps/desktop/src/components/MatchRoundPanel.test.tsx` (or add test case in existing test file):
```tsx
it('renders opponent avatar with resolved URL when in match', () => {
  const match = {
    id: 'm1',
    phase: 'pick',
    round_seq: 1,
    opponent: { id: 'opp-1', display_name: 'Nemesis', pfp_url: '/api/objects/avatar-123' },
    my_card: null,
    score_mine: 0,
    score_opponent: 0,
  } as any;
  render(
    <MatchRoundPanel
      match={match}
      players={[]}
      identity={null}
      myCards={[]}
      soundEnabled={false}
      onPick={vi.fn()}
      onDecide={vi.fn()}
      onQuit={vi.fn()}
    />
  );
  const img = screen.getByRole('img');
  expect(img.getAttribute('src')).toContain('/api/objects/avatar-123');
});
```

**Step 2: Run test to verify failure**
Run: `npm test -w @gmatch/desktop -- src/components/MatchRoundPanel.test.tsx`
Expected: FAIL if matching on resolved URL / fallback

**Step 3: Implement minimal change**
In `apps/desktop/src/components/MatchRoundPanel.tsx`:
1. Import `Avatar` from `./Avatar`.
2. Compute `opponentPfp`:
   ```tsx
   const opponentPfp = match.opponent.pfp_url || opponentUser?.pfp_url || undefined;
   ```
3. In the module header:
   ```tsx
   <div className="flex-shrink-0">
     <Avatar id={match.opponent.id} size={20} imageUrl={opponentPfp} />
   </div>
   ```
   replacing the raw un-resolved `<img>` block.

**Step 4: Run test to verify pass**
Run: `npm test -w @gmatch/desktop -- src/components/MatchRoundPanel.test.tsx`
Expected: PASS

**Step 5: Commit**
```bash
git add apps/desktop/src/components/MatchRoundPanel.tsx
git commit -m "fix(desktop): render opponent avatar via Avatar component in duel match panel"
```

---

### Task 4: Full Suite Validation and Build Verification

**Objective:** Verify all desktop and API workspaces pass typecheck, lint, and tests with 0 errors.

**Step 1: Typecheck**
Run: `npm run typecheck --prefix I:/goongrid/apps/desktop && npm run typecheck --prefix I:/goongrid/apps/api`
Expected: Exit code 0, 0 errors.

**Step 2: Vitest Suites**
Run: `npm test -w @gmatch/desktop && npm test -w @orbit/api`
Expected: All tests pass.

**Step 3: Verification commit**
```bash
git status -sb
```
Ensure working tree is clean.

---

## Risks, Tradeoffs, and Open Questions
- **Risk:** Base64 vs object URL formats in `pfp_url`. Handled: `resolveMediaUrl` supports both `data:image/...` and relative `/api/objects/...` paths seamlessly.
- **Tradeoff:** Making `is_avatar = 1` public in `GET /api/objects/:id` intentionally aligns with user avatars being public profile data across the platform, matching the existing behavior of posts and stories.
