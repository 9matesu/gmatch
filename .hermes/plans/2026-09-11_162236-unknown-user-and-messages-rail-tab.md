# Fix "Unknown User" on posts + move Messages into the bottom-right rail tab

Repo: `I:/goongrid` (apps/api + apps/desktop). Branch off current `main`/HEAD (was `e10f807`).
Line numbers cited below were verified 2026-09-11 against HEAD `e10f807`. Re-grep before
patching; the repo mixes CRLF — use the `patch` tool (or the incremental-file-editing
newline-preserving recipe), never sed. NEVER `git add -A` (parallel agent may share the
worktree) — commit only the explicit paths you touched.

## Goal

Make freshly uploaded posts stop rendering "Unknown User" as author, and remove the
Messages entry from the desktop sidebar in favor of the already-existing MessagesRail:
a fixed, always-collapsed tab anchored at the bottom-right that expands upward into a
drawer without overlapping or overflowing anything.

## Current context (traced, cite-ready)

### "Unknown User"

- Server: `apps/api/src/routes/posts.ts` line 66 (`serializePost`), 234 and 332 (comment
  serializers) do `row.author_name?.trim() || 'Unknown User'`. A user whose DB
  `display_name` is NULL/empty (registration does not force a name; `posts.test.ts:25`
  proves a nameless authenticated user is a real state) gets the literal
  "Unknown User" on the feed, on `GET /api/posts/:id`, in comments, and in the
  realtime `broadcastNewPost` push — for their OWN uploads too. This is the reported
  bug's root: one fallback literal shared by all post surfaces.
- The codebase ALREADY has the intended idiom: `generateFallbackName(orbitId)` exported
  from `@orbit/shared` (`packages/shared/src/index.ts:26` → `User_<short-id>`), used by
  `apps/api/src/routes/users.ts:76,207` and `apps/desktop/src/utils/lobby.ts:67`.
  Fix = reuse it, do not invent a new formatter.
- Client hardcodes (secondary, same string, own/P2P surfaces only):
  - `apps/desktop/src/App.tsx:2083` — local IndexedDB object owned by someone else is
    hardcoded `'Unknown User'` even though the full `users` directory is in
    `usersRef.current` (used the very next pattern at `:2132`).
  - `apps/desktop/src/App.tsx:2407` — WebRTC-received object hardcodes
    `display_name: 'Unknown User'` while `:2429` (a few lines below) does the proper
    `usersRef.current` lookup for the toast.
  - Do NOT sweep the remaining ~50 `'Unknown User'` literals in chat/lobby/admin
    surfaces — out of scope, they are not the upload path.

### Messages rail

- `apps/desktop/src/components/chat/MessagesRail.tsx` already ships the wave-1 design:
  collapsed edge handle at `fixed right-0 bottom-24` (lines ~41-52), open drawer at
  `fixed right-2 bottom-2 h-[60vh] w-[min(920px,calc(100vw-2rem))]` (line ~55).
  Gaps vs. the ask: handle is 24 units off the bottom (not "anchored bottom-right"),
  the handle stays rendered when open and physically overlaps the drawer's right edge,
  and the drawer has no in-panel collapse control / max-height guard.
- `apps/desktop/src/components/home/SidebarNav.tsx:317-323` — the desktop sidebar still
  has a `Messages` nav entry (`icon: Send`, `action: onOpenChat`, `badge:
  unreadMessagesCount`). This is the duplicate entry point to delete (one function, one
  control). Props that exist only for it: `onOpenChat` (interface :81, destructure :54),
  `chatOpen` (:82, :55, used only at :320 — notifications use the separate
  `notificationsOpen` prop), `unreadMessagesCount` (:86, :59, used only at :322).
  Their call sites are `App.tsx:2925-2934` (onOpenChat), `:2935` (chatOpen),
  `:2949` (unreadMessagesCount).
- Mobile stays untouched: `HomeFooter` (`apps/desktop/src/components/home/HomeFooter.tsx:85-89`,
  mobile-only via `.mobile-footer` CSS, `globals.css:1455-1464`) keeps its Messages tab,
  which routes through `handleSetMainView('messages')` → inline `MessagesView` on mobile
  (`App.tsx:3122`). Rail chrome is `hidden md:*` everywhere.
- Desktop deep link `#/messages` on cold load: `App.tsx:185-193` `mainView` useState
  initializer takes the hash verbatim → inline `MessagesView` renders on desktop behind
  the (closed) rail. After this change desktop should land on feed + rail open instead.
  `handleSetMainView` (`App.tsx:297-304`) already has the desktop matchMedia branch for
  clicks; extract its `isDesktopViewport()` check so both places share it.
- z-scale (`apps/desktop/src/globals.css:41-45`): dropdown 40 / modal 50 / lightbox 60 /
  toast 70 / system 80. The drawer must stay BELOW modals/toasts (it currently is:
  `--z-dropdown`), so an open CreatePost modal or a toast never gets buried. Toast stack
  is `fixed bottom-20 md:bottom-5 right-5 z-[--z-toast] pointer-events-none`
  (`components/Toast.tsx:44`) — transient overlap with the collapsed handle is accepted
  (it does not block clicks; see Risks).
- Glyph idiom: `⌃ ⌄` are the sanctioned bare disclosure glyphs (DESIGN.md); no button
  casing on small controls (`p-1.5 rounded-md hover:bg-glass-w*`).
- UPPERCASE micro-labels require `tracking-wider` (grep gate).

## Architecture

Fix the string at its source: every post/comment serializer in `routes/posts.ts` gets
the existing `generateFallbackName(owner_id)` fallback (one function, all callers), and
the two client hardcoded spots do the same `usersRef` lookup + fallback the sibling
toast already does. For nav: delete the sidebar Messages entry (desktop control moves
exclusively to the rail), re-anchor the rail handle to the true bottom-right corner,
render the handle ONLY while collapsed, and put the collapse control in a slim panel
header so the upward-growing drawer can never cover its own tab. Cap the drawer height
with `max-h-[calc(100vh-6.5rem)]` so nothing overflows the viewport.

---

## Task 1 — Server: fallback author name (TDD, api)

1a. RED — add to `apps/api/src/routes/posts.test.ts` (top-level, next to the existing
`it(...)` blocks; `alice`/`bob` are already at module scope, add a third identity):

```ts
const carol = createTestIdentity()

it('names a nameless post author with the generated fallback, never "Unknown User"', async () => {
  const namelessEnv = await createMockEnv()
  await registerUser(namelessEnv, carol) // no setDisplayName call
  const pid = await createPublicPost(namelessEnv, carol, 'no name here')
  const res = await app.request('/api/posts', {
    headers: authHeaders(carol, 'GET', '/api/posts'),
  }, namelessEnv)
  const json: any = await res.json()
  const post = json.posts.find((p: any) => p.id === pid)
  expect(post).toBeTruthy()
  expect(post.author_name).not.toBe('Unknown User')
  expect(post.author_name).toMatch(/^User_/)
})
```

Run: `cd I:/goongrid/apps/api && npx vitest run src/routes/posts.test.ts -t "generated fallback"`
Expected: FAIL with `expected 'Unknown User' to match /^User_/`.

1b. GREEN — in `apps/api/src/routes/posts.ts`:
- Add import next to the others (line ~6): `import { generateFallbackName } from '@orbit/shared'`
- Line 66: `author_name: row.author_name?.trim() || 'Unknown User',` →
  `author_name: row.author_name?.trim() || generateFallbackName(row.owner_id),`
- Line 234: `author_name: c.author_name?.trim() || 'Unknown User',` →
  `... || generateFallbackName(c.author_id),`
- Line 332: same replacement as 234.

`serializePost` receives `owner_id` because every SELECT includes `o.owner_id`
(verified lines 45, 91, 152). `@orbit/shared` is already an apps/api dependency
(`routes/users.ts:5` imports from it).

Run the same command → PASS. Then full api suite:
`cd I:/goongrid/apps/api && npx vitest run` → all green (~840 tests; stray
`test-blobs-*` dirs in apps/api/ are test artifacts, ignore).

Commit: `git add apps/api/src/routes/posts.ts apps/api/src/routes/posts.test.ts && git commit -m "fix(posts): generated fallback author name instead of Unknown User"`

## Task 2 — Client: resolve real names for local + P2P objects

No new unit test (this lives in a 3800-line App.tsx init path; gates are tsc + the full
desktop suite). Edits in `apps/desktop/src/App.tsx`:

2a. Line 33 import — `import { MIN_GAME_CARDS, type User, type OrbitObject } from "@orbit/shared";`
→ add the value import: `import { MIN_GAME_CARDS, generateFallbackName, type User, type OrbitObject } from "@orbit/shared";`

2b. Line ~2083 (inbox merge of local IndexedDB objects), replace the ternary tail
`: 'Unknown User',` with:

```ts
          display_name: dbObj.owner_id === identity.orbitId
            ? (myProfile.displayName || 'You')
            : (usersRef.current.find((u) => u.id === dbObj.owner_id)?.display_name?.trim() || generateFallbackName(dbObj.owner_id)),
```

2c. Line ~2407 (WebRTC `peer.onComplete` item), replace `display_name: 'Unknown User',` with:

```ts
                display_name: usersRef.current.find((u) => u.id === offer.sender_id)?.display_name?.trim() || generateFallbackName(offer.sender_id),
```

(`usersRef.current` is already the pattern used by the toast two lines below at
`:2429`, so no new deps; the `useEffect` at :2083's site runs after `usersRef` exists.)

Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` → 0 errors.
Commit: `git add apps/desktop/src/App.tsx && git commit -m "fix(client): resolve real sender names for local and P2P objects"`

## Task 3 — MessagesRail: corner-anchored collapsed tab, non-overlapping upward drawer (TDD, desktop)

3a. RED — create `apps/desktop/src/components/chat/MessagesRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessagesRail } from './MessagesRail'

const base = {
  onToggle: vi.fn(),
  unreadCount: 2,
  users: [],
  profilePics: {},
  onOpenProfile: vi.fn(),
  groups: [],
}

describe('MessagesRail', () => {
  it('collapsed: handle is fixed to the bottom-right corner and nothing else renders', () => {
    render(<MessagesRail open={false} {...base}>child</MessagesRail>)
    const handle = screen.getByRole('button', { name: 'Expand messages' })
    expect(handle.className).toMatch(/fixed/)
    expect(handle.className).toMatch(/bottom-2/)
    expect(handle.className).toMatch(/right-0/)
    expect(screen.queryByText('child')).not.toBeInTheDocument()
    fireEvent.click(handle)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('open: drawer renders above the corner, handle is gone, collapse control lives in the panel header', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand messages' })).not.toBeInTheDocument()
    const collapse = screen.getByRole('button', { name: 'Collapse messages' })
    const panel = collapse.closest('[data-rail-panel]')
    expect(panel).toBeTruthy()
    fireEvent.click(collapse)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('drawer is height-capped so it never overflows the viewport', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByRole('button', { name: 'Collapse messages' }).closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/max-h-\[calc\(100vh-6\.5rem\)\]/)
    expect(panel!.className).toMatch(/z-\[var\(--z-dropdown\)\]/)
  })
})
```

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/components/chat/MessagesRail.test.tsx`
Expected: FAIL (handle still renders when open, no `data-rail-panel`, wrong bottom class, etc).

3b. GREEN — rewrite the two chrome pieces of
`apps/desktop/src/components/chat/MessagesRail.tsx` (keep the aside/players/groups body
as-is; only touch the handle button block ~lines 41-52 and the panel opening div
~line 55). Full replacement of the handle + panel-open:

```tsx
      {!open && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label="Expand messages"
          title="Messages"
          className="hidden md:flex fixed right-0 bottom-2 z-[var(--z-dropdown)] flex-col items-center gap-1.5 py-3 px-1 rounded-l-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer select-none"
        >
          <span className="text-lg leading-none" aria-hidden>⌃</span>
          <span className="text-[10px] tracking-wider" style={{ writingMode: 'vertical-rl' }}>Messages</span>
          {unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-retro-fg" />}
        </button>
      )}

      {open && (
        <div
          data-rail-panel
          className="hidden md:flex flex-col fixed right-2 bottom-2 z-[var(--z-dropdown)] h-[60vh] max-h-[calc(100vh-6.5rem)] w-[min(920px,calc(100vw-1rem))] rounded-xl border border-border-glass bg-retro-panel shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-glass shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-retro-muted">Messages</span>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-label="Collapse messages"
              className="p-1.5 rounded-md hover:bg-glass-w8 text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              <span className="text-base leading-none" aria-hidden>⌄</span>
            </button>
          </div>
          <div className="flex-1 min-h-0 flex">
```

Then close one more `</div>` at the panel's end (the existing closing `</div>` of the
old panel body now closes the inner flex row; add a matching `</div>` before the
`)} that closes the `open &&` block). The old left-column wrapper
`<div className="flex-1 min-w-0 p-2 border-r border-border-glass">{children}</div>`
and the `<aside>` stay, now inside the new `flex-1 min-h-0 flex` row (aside also needs
`min-h-0` — it scrolls internally).

No `playPress` calls added inside the component (sounds stay in App's `onToggle`,
keeping jsdom free of AudioContext). The rail's existing `playPress(700)` on the
players/groups tab buttons stays.

Run the 3a command → PASS. Also re-run
`npx vitest run src/components/chat/` → green.

Commit: `git add apps/desktop/src/components/chat/MessagesRail.tsx apps/desktop/src/components/chat/MessagesRail.test.tsx && git commit -m "feat(nav): messages rail anchored bottom-right; handle only when collapsed, in-panel collapse control"`

## Task 4 — Delete the sidebar Messages entry (TDD, desktop)

4a. RED — append to `apps/desktop/src/components/home/SidebarNav.test.tsx`:

```tsx
// One function, one control: desktop chat lives in the bottom-right rail only.
describe('SidebarNav messages entry removal', () => {
  it('renders no Messages nav button', () => {
    render(<SidebarNav />)
    expect(screen.queryByRole('button', { name: /messages/i })).not.toBeInTheDocument()
  })
})
```

(If the rail handle ever renders inside SidebarNav it doesn't — it's an App-level
sibling — but if this test trips on an unrelated "messages"-named control, scope the
query with `within(nav)` instead of loosening the assertion.)

Run: `cd I:/goongrid/apps/desktop && npx vitest run src/components/home/SidebarNav.test.tsx -t "Messages nav button"` → FAIL.

4b. GREEN — 
- `apps/desktop/src/components/home/SidebarNav.tsx`: delete the object at lines
  317-323 (`id: 'messages', ... badge: unreadMessagesCount,`). Remove from Props
  interface: `onOpenChat?: () => void;` (:81), `chatOpen?: boolean;` (:82),
  `unreadMessagesCount?: number;` (:86). Remove from the destructure (:54, :55, :59 —
  `chatOpen = false,` and `unreadMessagesCount = 0,` have defaults). Drop `Send` from
  the lucide import list (line 15) if grep shows no other use:
  `grep -n "Send" apps/desktop/src/components/home/SidebarNav.tsx` → only the import.
- `apps/desktop/src/App.tsx` SidebarNav call site: delete the `onOpenChat={...}` prop
  block (:2925-2934), `chatOpen={chatOpen && panelTab === 'chat'}` (:2935), and
  `unreadMessagesCount={pmUnreadCount}` (:2949). Keep `onGroupToggle`,
  `notificationsOpen`, `onOpenNotifications` untouched (notifications still open the
  rail via `chatOpen`+`panelTab` server-side state, and `pmUnreadCount` is still used
  at the rail (:3549) and HomeFooter (:3831).

Re-run 4a command → PASS; then `npx vitest run src/components/home/` green,
`npx tsc --noEmit` 0 errors.

Commit: `git add apps/desktop/src/components/home/SidebarNav.tsx apps/desktop/src/components/home/SidebarNav.test.tsx apps/desktop/src/App.tsx && git commit -m "feat(nav): drop sidebar Messages duplicate; rail is the only desktop entry"`

## Task 5 — Desktop deep-link: #/messages opens the rail, not the inline view

No unit test (init-time matchMedia/hash logic; covered by the Playwright journey in
Task 6). In `apps/desktop/src/App.tsx`:

5a. Add a module-scope helper just above `export default function App` (next to
`viewFromHash`, ~line 187 area — keep it outside the component):

```ts
const isDesktopViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 768px)').matches

// Desktop has no inline messages view: #/messages (or a persisted 'messages'
// main view) opens the bottom-right rail instead.
const desktopChatOnLoad = () => {
  if (typeof window === 'undefined' || !isDesktopViewport()) return false
  const fromHash = viewFromHash(window.location.hash)
  const saved = localStorage.getItem('orbit_main_view')
  return fromHash === 'messages' || (!fromHash && saved === 'messages')
}
```

5b. `mainView` initializer (:185-193): right before each `return ... 'messages'`-capable
exit is unnecessary — wrap the whole initializer body's result instead: rename nothing;
change the final `return` paths by computing then normalizing:

```ts
  const [mainView, setMainView] = useState<MainViewType>(() => {
    if (typeof window === 'undefined') return 'feed'
    // Direct URL wins over the last-visited persisted view (plan §5).
    const fromHash = viewFromHash(window.location.hash)
    const saved = localStorage.getItem('orbit_main_view') as MainViewType | null
    const resolved = fromHash || (saved && ROUTE_VIEWS.includes(saved as RoutedView) ? saved : 'feed')
    // Desktop never renders the inline messages view (rail only).
    return resolved === 'messages' && isDesktopViewport() ? 'feed' : resolved
  });
```

(Keep `hasMoreFeed`-style behavior identical: this preserves the hash-over-saved
precedence and the `ROUTE_VIEWS` validation exactly.)

5c. `chatOpen` initializer (:204): `const [chatOpen, setChatOpen] = useState(false);` →
`const [chatOpen, setChatOpen] = useState(() => desktopChatOnLoad());`
(`panelTab` already defaults to `'chat'`, so the rail opens on the chat tab.)

5d. DRY the existing duplicate inside `handleSetMainView` (:297-301): delete its local
`const isDesktop = window.matchMedia(...)` definition and use `isDesktopViewport()`.

Verify: `cd I:/goongrid/apps/desktop && npx tsc --noEmit` → 0 errors.

Commit: `git add apps/desktop/src/App.tsx && git commit -m "fix(nav): desktop messages deep link opens the rail instead of the inline view"`

## Task 6 — Full gates + journey check

6a. If any e2e spec clicks the sidebar by name (grep first:
`grep -rn "messages" apps/desktop/e2e/social.spec.ts apps/desktop/e2e/journeys.spec.ts apps/desktop/e2e/engagement.spec.ts -i`):
- `page.goto('/#/messages')` on a desktop viewport now yields mainView 'feed' + open
  rail. Assertions must target the rail content (SocialPanel children) or the
  `Collapse messages` button — not a sidebar Messages button. Update assertions to:
  `await expect(page.getByRole('button', { name: 'Collapse messages' })).toBeVisible()`
  after the goto on desktop viewports; keep mobile-viewport flows on HomeFooter.

6b. Run, in order, each with expected result:
- `cd I:/goongrid/apps/api && npx vitest run` → all pass
- `cd I:/goongrid/apps/desktop && npx vitest run` → all pass (~663 + new files)
- `cd I:/goongrid/apps/desktop && npx tsc --noEmit` → 0 errors
- eslint per the repo gate → 0 errors (warnings in untouched files don't block)
- DESIGN.md greps: `grep -rn "uppercase " apps/desktop/src/components/chat/MessagesRail.tsx | grep -v tracking` → empty;
  no raw-zinc literals added (`grep -n "zinc" apps/desktop/src/components/chat/MessagesRail.tsx` → empty)
- `cd I:/goongrid/apps/desktop && npx playwright test e2e/social.spec.ts e2e/engagement.spec.ts` → pass
  (flaky single journeys: re-run once before believing a failure)
- Manual eye-check (optional but recommended): `cd I:/goongrid/apps/desktop && npm run dev`,
  open :5173 at desktop width with ADMIN_PIN set per the local-dev recipe, post a
  public image as a nameless account → card shows `User_xxxxxx`, never "Unknown
  User"; confirm no sidebar Messages item, collapsed tab at the very bottom-right
  corner, click expands upward, drawer clears the tab, toasts ride on top
  non-blocking, modals cover the drawer.

If any e2e capture screenshots are regenerated by the playwright run (`site/img/*.png`
dirty), do NOT mix them into feature commits: verify `node site/check.mjs` prints OK
and commit separately as `chore(site): refresh capture screenshots`.

Final commit state expected: 6 commits, tree clean except pre-existing foreign
(opencode-agent) dirty files — leave those alone.

## Risks / tradeoffs / notes

- Collapsed handle at `right-0 bottom-2` sits under the transient toast stack
  (`bottom-5 right-5`, z-toast 70 > 40). Toasts are `pointer-events-none`, so the tab
  stays clickable under them; accepted. Add a bottom-offset bump only if the user
  complains.
- `max-h-[calc(100vh-6.5rem)]` reserves 6.5rem (handle ≈ 96px + gap); on very short
  windows the drawer shrinks before it ever reaches the tab. Panel is 8px in from the
  right edge, handle flush right — no horizontal overlap either.
- The server fix is display-time, not a DB backfill: nameless accounts keep NULL
  `display_name` and render `User_<shortid>` everywhere the posts/users serializers
  run (same semantics as `GET /api/users/profile`). A registration-time write would
  be the "real" fix but touches auth + a data migration for existing rows — YAGNI
  until the user asks for names to be non-editable-fallback.
- Other surfaces (chat PM names at `App.tsx:1242/1267/...`, lobby, admin tabs) still
  carry `'Unknown User'` literals by design scope. Grep `'Unknown User'` count at the
  end will be < 59 (start) but > 0 — do not "finish" the sweep without being asked.
- `handleSetMainView('messages')` from the mobile HomeFooter still sets chat state on
  desktop-sized windows only via its existing matchMedia branch — unchanged behavior,
  now shared through `isDesktopViewport()`.
