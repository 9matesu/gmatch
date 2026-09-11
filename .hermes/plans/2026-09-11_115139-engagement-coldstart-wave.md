# Sidebar logout + For You feed + first-post nudge (engagement wave)

Date: 2026-09-11 11:51 (-0300). Repo: `I:/goongrid`, app: `apps/desktop`
(React 19 + Vite + vitest + Playwright), server `apps/api` (Hono + SQLite).
Read first: `docs/DESIGN.md` (V1 token contract), `docs/ENGAGEMENT.md` (created by
this plan), skill `gmatch-frontend-work` pitfalls. Copy rules from today's humanize
sweep stay in force (no hype, no exclamation inflation, PT users, EN strings).
Ponytail: reuse everything measured below; the ladder's rungs 1-2 kill most of the
"add a recommendation engine" fantasy — the scoring function and tag-affinity
already exist.

## Goal

Give the sidebar a one-click logout, make the timeline open on a For You feed,
turn the empty timeline into a first-post + first-follows nudge, and wire the
existing status/follower machinery into visible feedback — documented, tested,
iterated until the journey looks right.

## Current context (verified, path:line evidence)

- Logout today lives in TWO places only: `IdentityModal.tsx:138 handleConfirmLogout`
  (opens via `identityModalMode === 'logout'`, App.tsx:665, GlobalModals.tsx:112-138
  does the full state reset) and a buried settings row
  (`GMatchSettingsModal.tsx:800` "Log out of this device"). There is no sidebar
  entry. THE correct wiring is `setIdentityModalMode('logout')` — it already resets
  profile/chat/hacks state; do NOT call `clearIdentity()` bare.
- Sidebar user chip: `src/components/home/SidebarNav.tsx:572-598` (avatar + name +
  presence; whole button opens the profile view). Props are passed from
  `App.tsx:2902` (`<SidebarNav ...>`). The icon-only pattern per DESIGN.md:
  bare `p-1.5 rounded-md hover:bg-glass-w10` + `aria-label`.
- Feed sort state: `App.tsx:906 const [feedSort, setFeedSort] = useState<'latest'|'trending'>('latest')`.
  Requests go out `?sort=${feedSort}` (App.tsx:936 loadServerFeed, :955 loadMore);
  server supports it (`apps/api/src/routes/posts.ts:114 sort query, :142 trending
  orderBy`). Client ALSO re-sorts with a richer local algorithm
  (GMatchFeed.tsx:353-383: `likes*2 + comments*3 + tagAffinity*4 / age^0.6` where
  tagAffinity is learned from the user's own liked posts via `boostTagAffinity`,
  GMatchFeed.tsx:394). So "For You" = the local trending sort; it exists.
- Sort toggle UI: GMatchFeed.tsx:547-563 renders pills `Latest | Trending`.
- Empty timeline state: GMatchFeed.tsx:935-952 — icon + "No posts yet" +
  "Upload your first post and it shows up here." + a button wired to
  `onOpenPostCreator` (prop at :155, App passes `() => { setChatOpen(false);
  setShowCreatePostModal(true) }` style callbacks around App.tsx:2902-2930).
  The empty state fires on `displayPosts.length === 0` (whole feed empty).
  NOTE it does not distinguish "empty because you follow nobody" from "empty
  because the server has no posts" — the nudge will cover both.
- Follow machinery: `toggleFollowUser` exists (App.tsx → GlobalModals.tsx:86,321;
  users list in `App.tsx` `users` state; followers_count from server
  `apps/api/src/routes/users.ts:82,340` — status IS already a stored metric).
  Profile cards show follower counts (GMatchProfile.tsx:147).
- Notifications for social events (like/follow/comment) are server-pushed via
  `apps/api/src/notifications.ts` + `useNotifications` — verify each event type
  fires (grep `'card_received'`-style constants) rather than assuming.
- Existing pure-helper-with-test pattern to imitate:
  `src/firstRun/serverSort.ts` + `serverSort.test.ts`.
- Feed tests: `SharePostModal.test.tsx` shows the jsdom render+stub pattern;
  SidebarNav has its own `SidebarNav.test.tsx` (fetch stub in beforeEach).
- Vitest localStorage Proxy pitfall and `vi.stubGlobal('fetch')` pattern apply
  to any new test (see existing files).
- House gates before every commit: `npm run lint` (0 errors), `npx tsc --noEmit -p
  tsconfig.json` (0), `npx vitest run` (675 baseline). DESIGN.md acceptance greps
  stay 0. Playwright: `npx playwright test` from `apps/desktop`, seeded via
  `e2e/helpers.ts seedApp/mockBooruFeed`.

## Engagement design (the Meta/X-patterns part, kept honest)

What this app's status loop actually is (measured, not invented): post →
likes/comments accumulate into `score` + `likes_received` + `followers_count`
(users.ts) → leaderboard/ranks tabs consume them → notifications tell you when
your content moved someone. The engagement gaps are visibility gaps, not metric
gaps: the metrics exist but the FEEDBACK is silent. So the wave is:

1. **Cold start (empty timeline)** = highest-drop-off point in every social
   funnel. One card, two asks, both already wired: upload (onOpenPostCreator) and
   follow people (a 3-person "start here" strip from the users list ranked by
   tag affinity — pure helper, new code, ~40 lines). Copy per the humanizer: the
   user's own words "Empty in here? Start posting and get things moving." are the
   title; no exclamation pile-on, no "Join the conversation!" slop.
2. **For You first, always.** Default `feedSort: 'trending'` (the local
   affinity-boosted ranking), relabel the pill `Trending → For You`
   (Instagram/TikTok convention: algorithmic feed is the default landing tab,
   chronological is opt-in). Server `?sort=trending` stays the fetch order; the
   client re-rank refines it with learned affinities — both already exist.
3. **Status feedback loops (no new metrics, wire what exists):**
   - Like counter already animates via optimistic update + double-tap heart
     burst (GMatchFeed.tsx:809, InstagramPostModal.tsx:131). Keep.
   - Add a per-post micro-line on YOUR OWN posts only: `N likes · M comments` is
     already shown; the new bit is the FIRST-LIKE celebration: when a post by me
     crosses like_count 0→1 during this session, play `playWin()` once (throttled
     `*Once` export per sounds.ts house rule) + a one-time "+ first like" flash
     chip on the card. That's the "variable reward" hook done small. NOTE:
     server-side `first_like` notification is OUT of scope (would need a new
     notifier + migration); session-local flash ships today.
   - Follower-gain feedback already exists as server notifications; verify it
     lands in the grouped bell (client fold shipped today, commit e7217f7).
4. **Anti-dark-pattern guardrail (state in ENGAGEMENT.md):** no fake urgency,
   no phantom notification badges, no streak shaming, no infinite-scroll
   manipulation beyond what the feed already has. For You ranks real local
   signals; the nudge card disappears forever after the first post. This is the
   line between engagement and coercion; document it so future agents don't
   cross it.

## Tasks

### Task 1 — docs/ENGAGEMENT.md (spec-first, 10 min, no code)

Create `I:/goongrid/docs/ENGAGEMENT.md`:

```markdown
# gMatch engagement loop (documented mechanisms)

Status/follower economy exists server-side already: Users.score (season),
Users.score_total (lifetime), Users.likes_received, Users.followers_count,
ranks tab, match payouts (matchEconomy, card-valuation). This doc records what
drives engagement and where it is wired, so no one rebuilds or invents parallel
systems.

## Loops (wired)
| Loop | Signal | Where |
|---|---|---|
| Cold start | empty timeline -> upload nudge + 3 follow suggestions | GMatchFeed empty state, suggestFollows() |
| Feed default | For You (local affinity re-rank) opens first | App feedSort default 'trending' |
| Content reward | like/comment notifications (server -> grouped bell) | apps/api/src/notifications.ts |
| First like | session-local flash + sfx on my post 0->1 likes | GMatchFeed FirstLikeFlash |
| Status display | follower counts on profile, ranks leaderboard | GMatchProfile, ranks tab |
| Money->status | g$ from likes/idle buys cards, cards win duels | card-valuation, lobby.ts |

## Rules
- New engagement surfaces must use existing metrics; a new counter needs a
  server column + a reason the client can't derive it.
- No fake badges, no phantom counts, no shame copy. Nudges are one-time and
  disappear on first success.
- All copy follows the humanizer sweep rules (flat, specific, EN).
```

Verify: file exists, `git log` after commit. Commit:
`git add docs/ENGAGEMENT.md && git commit -m "docs: engagement loop spec"`

### Task 2 — sidebar logout button (TDD)

RED: append to `src/components/home/SidebarNav.test.tsx` (file already stubs
fetch in beforeEach):

```tsx
describe('SidebarNav logout', () => {
  it('renders a logout control next to the user chip and fires the callback', () => {
    const onLogout = vi.fn()
    render(<SidebarNav setMainView={vi.fn()} onLogout={onLogout} />)
    const btn = screen.getByRole('button', { name: /log out/i })
    fireEvent.click(btn)
    expect(onLogout).toHaveBeenCalledOnce()
  })
  it('hidden when no callback given', () => {
    render(<SidebarNav />)
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument()
  })
})
```

Run `npx vitest run src/components/home/SidebarNav.test.tsx` → FAIL (prop unknown
/ button missing).

GREEN, `src/components/home/SidebarNav.tsx`:
1. Import `LogOut` from lucide (extend the existing import list at top).
2. Add to the props interface (near the other optional callbacks):
   `onLogout?: () => void;` and destructure with the rest (`onLogout,`).
3. In the user panel block (~:572), restructure: wrap the existing chip button and
   a new logout button in a flex row. Replace the outer `<button>` with a div:

```tsx
      <div className="p-2 border-t border-white/10 shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { playPress(800); setMainView?.('profile'); }}
            className={`glass-nav-item ${mainView === 'profile' ? 'glass-nav-active' : ''} flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150 active:scale-[0.96] border ${collapsed ? 'justify-center' : ''}`}
            aria-label="Open your profile"
          >
            {/* existing avatar+name+presence content unchanged */}
          </button>
          {onLogout && !collapsed && (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
              className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" stroke={1.75} />
            </button>
          )}
        </div>
      </div>
```
(collapsed sidebar hides logout; logout is not a daily action worth a hot glyph —
the settings-tab path remains for collapsed users.)

Then wire in `src/App.tsx` SidebarNav call site (~:2902), add prop:
`onLogout={() => { setChatOpen(false); setIdentityModalMode('logout'); }}`
— `identityModalMode` setter already exists at App.tsx:665; IdentityModal owns
the confirm step (Sign out? text at :377). Do NOT bypass the confirm dialog.

Verify: `npx vitest run src/components/home/SidebarNav.test.tsx` → pass; tsc 0.
Commit: `git add apps/desktop/src/components/home/SidebarNav.tsx apps/desktop/src/components/home/SidebarNav.test.tsx apps/desktop/src/App.tsx && git commit -m "feat(sidebar): logout button opens confirm dialog"`

### Task 3 — For You default (TDD, tiny)

RED: new file `src/components/feed/feedSort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEED_SORT, FEED_SORT_LABELS, isFeedSort } from './feedSort';

describe('feedSort contract', () => {
  it('starts on For You', () => {
    expect(DEFAULT_FEED_SORT).toBe('trending');
  });
  it('labels trending as For You, latest stays Latest', () => {
    expect(FEED_SORT_LABELS.trending).toBe('For You');
    expect(FEED_SORT_LABELS.latest).toBe('Latest');
  });
  it('isFeedSort guards persisted junk', () => {
    expect(isFeedSort('latest')).toBe(true);
    expect(isFeedSort('for-you')).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});
```

GREEN, new file `src/components/feed/feedSort.ts`:

```ts
export type FeedSort = 'latest' | 'trending';
export const DEFAULT_FEED_SORT: FeedSort = 'trending';
export const FEED_SORT_LABELS: Record<FeedSort, string> = {
  trending: 'For You',
  latest: 'Latest',
};
export function isFeedSort(v: unknown): v is FeedSort {
  return v === 'latest' || v === 'trending';
}
```

Wire (3 edits):
- `src/App.tsx:906`: `useState<'latest' | 'trending'>('latest')` →
  `useState<FeedSort>(() => { const s = localStorage.getItem('orbit_feed_sort'); return isFeedSort(s) ? s : DEFAULT_FEED_SORT })`
  and persist next to the existing `orbit_main_view` effect (copy its
  try/catch shape): `try { localStorage.setItem('orbit_feed_sort', feedSort) } catch {}`.
  (Respect returning users' choice — forcing For You on someone who pinned Latest
  every session is the coercion we banned in ENGAGEMENT.md.)
- `src/components/feed/GMatchFeed.tsx:560`: `{mode === 'latest' ? 'Latest' : 'Trending'}`
  → `{FEED_SORT_LABELS[mode]}` (import from `./feedSort`).
- `src/App.tsx:936/:955` already template `?sort=${feedSort}` — server side needs
  nothing (trending already orderBy-supported, posts.ts:142).
- Type usages: replace inline `'latest' | 'trending'` unions in GMatchFeed props
  (:173) with `FeedSort` import. Same for App.tsx:906 declaration.

Verify: feedSort.test passes; tsc 0; grep `FEED_SORT_LABELS` finds exactly the
new module + GMatchFeed.
Commit: `git add ... && git commit -m "feat(feed): For You default tab, choice persisted"`

### Task 4 — cold-start nudge: follow suggestions (pure helper, TDD)

New file `src/components/feed/suggestFollows.ts` + test. Ranking rule (documented
in ENGAGEMENT.md): exclude self, exclude already-followed, score = tag-affinity
overlap with MY profile tags (affinity map already lives in GMatchFeed as
`tagAffinities` state — the helper takes it as a plain record so it stays pure),
then followers_count desc as the status signal, online-first.

```ts
// src/components/feed/suggestFollows.test.ts
import { describe, expect, it } from 'vitest';
import { suggestFollows, type SuggestUser } from './suggestFollows';

const u = (id: string, tags: string[], followers = 0, online = false): SuggestUser =>
  ({ id, display_name: id, tags, followers_count: followers, online });

describe('suggestFollows', () => {
  const users = [
    u('me', ['cars']), u('a', ['foot', 'leather'], 5, true),
    u('b', ['cars'], 99, false), u('c', ['food'], 50, true),
  ];
  it('excludes self and followed, caps at 3, ranks online+affinity first', () => {
    const got = suggestFollows(users, 'me', ['foot'], new Set(['c']));
    expect(got.map((x) => x.id)).toEqual(['a', 'b']); // a: online+affinity, b: follower-count
  });
  it('with no affinity signal, online then followers decides', () => {
    expect(suggestFollows(users, 'me', [], new Set()).map((x) => x.id))
      .toEqual(['c', 'a', 'b']); // c online 50f, a online 5f, b offline 99f
  });
  it('empty input -> empty output', () => {
    expect(suggestFollows([], 'me', [], new Set())).toEqual([]);
  });
});
```

```ts
// src/components/feed/suggestFollows.ts
export interface SuggestUser {
  id: string
  display_name?: string
  tags?: string[]
  followers_count?: number
  online?: boolean
}

export function suggestFollows(
  users: SuggestUser[],
  selfId: string | null | undefined,
  myTags: string[],
  following: ReadonlySet<string>,
  limit = 3,
): SuggestUser[] {
  const mine = new Set(myTags.map((t) => t.toLowerCase()));
  return users
    .filter((x) => x.id && x.id !== selfId && !following.has(x.id))
    .map((x) => ({
      x,
      score:
        (x.online ? 100 : 0) +
        (x.tags?.some((t) => mine.has(t.toLowerCase())) ? 50 : 0) +
        Math.min(49, Number(x.followers_count ?? 0) / 10), // followers tie-break, never outranks presence+affinity
    }))
    .sort((a, b) => b.score - a.score || b.x.followers_count! - a.x.followers_count!)
    .slice(0, limit)
    .map((s) => s.x);
}
```

(ponytail: linear scan over the loaded users list, ceiling = list size ~200;
upgrade path is a server /api/suggestions endpoint if the list grows.)

Verify: `npx vitest run src/components/feed/suggestFollows.test.ts` (3 pass).
Commit: `git add src/components/feed/suggestFollows.* && git commit -m "feat(feed): pure follow-suggestion ranker"`

### Task 5 — cold-start nudge card UI

`src/components/feed/GMatchFeed.tsx` empty state (the block at ~:935-952 found by
`grep -n "No posts yet" src/components/feed/GMatchFeed.tsx` — re-locate, line
numbers drift after every edit): replace the current single-button block with:

```tsx
          {displayPosts.length === 0 && (
            <div className="bg-retro-panel border border-border-glass rounded-lg p-8 text-center space-y-4 shadow-xs my-4 max-w-md mx-auto">
              <div>
                <h4 className="text-sm font-semibold text-retro-fg">Empty in here? Start posting and get things moving.</h4>
                <p className="text-xs text-retro-muted mt-1 leading-relaxed">
                  One upload, three tags. Posts are what grow followers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (onOpenPostCreator) onOpenPostCreator(); else setShowCustomPostCreator(true); }}
                className={`${BTN} ${BTN_SMALL} ${BTN_PRIMARY}`}
              >
                Upload your first post
              </button>
              {suggestions.length > 0 && (
                <div className="pt-2 border-t border-border-glass">
                  <p className={`${MUTED} text-[10px] uppercase tracking-wider mb-2`}>Or follow someone</p>
                  <div className="flex items-center justify-center gap-3">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { void onFollowSuggestion?.(s.id); }}
                        className="flex flex-col items-center gap-1 cursor-pointer group"
                        aria-label={`Follow ${s.display_name}`}
                      >
                        <span className="w-10 h-10 rounded-full overflow-hidden border border-border-glass flex items-center justify-center text-xs text-retro-fg bg-glass-w5">
                          {(profilePics?.[s.id]) ? <img src={profilePics[s.id]} alt="" className="w-full h-full object-cover" /> : (s.display_name || s.id).slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-[10px] text-retro-muted truncate max-w-[72px] group-hover:text-retro-fg">{s.display_name}</span>
                        <span className="text-[10px] text-retro-fg border border-border-glass rounded-md px-1.5 py-0.5 group-hover:bg-glass-w10">Follow</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
```

New props on GMatchFeed (interface at ~:114-175; all optional, defaults keep old
callers compiling):
`onFollowSuggestion?: (userId: string) => void | Promise<void>;`
Compute `const suggestions = useMemo(() => displayPosts.length === 0 ? suggestFollows(users ?? [], identity?.orbitId, myProfileTags ?? [], new Set(followingIds ?? [])) : [], [displayPosts.length, users, identity, myProfileTags, followingIds]);`
— new prop `myProfileTags?: string[]` alongside.
App.tsx call sites (feed at :3079 and :3365 — both): pass
`onFollowSuggestion={(id) => toggleFollowUser(id)}` and
`myProfileTags={myProfile.tags}` (both already in App scope).

One test added to a new `src/components/feed/GMatchFeed.nudge.test.tsx`
(jsdom, minimal props + `posts={[]}`, users with 2 candidates; assert
`getByText(/Empty in here/)` and 2 follow buttons render, click fires callback).
Follow the stubGlobal(fetch) pattern from SidebarNav.test.tsx; if GMatchFeed's
mount does heavy fetches, mock them the same way (read SharePostModal.test.tsx
for the established mock surface before inventing a new one).

Verify: nudge test pass, tsc 0, full vitest green.
Commit: `git commit -m "feat(feed): cold-start nudge card with follow suggestions"`

### Task 6 — first-like flash (session-local)

`src/components/feed/GMatchFeed.tsx`: track posts authored by me
(`identity?.orbitId` vs `post.author_id`). In the effect that seeds `likeCounts`
(:297), keep a `useRef<Set<string>>` of my posts whose like count was already >0
at mount. In the like-count reconciliation path (:400) when a count crosses 0→1
for one of MY posts and it wasn't pre-liked at mount:
`setFirstLikeId(post.id)` + play the house `playWinOnce` if it exists in
`sounds.ts` (check first; if only `playWin` exists, wrap a throttled
`playWinOnce` there per the SFX discipline rule — *Once exports are the pattern),
and render a chip inside the card header row:

```tsx
{firstLikeId === post.id && (
  <span className="text-[10px] font-bold text-retro-fg bg-retro-panel border border-border-glass rounded-md px-1.5 py-0.5 animate-orbit-pop">
    First like
  </span>
)}
```
clear via the same setTimeout shape the double-tap animation uses (:809 pattern,
1500 ms).

Test: extend the nudge test file — render with `identity={{ orbitId: 'me', ... }}`
is heavy; instead unit-test only the crossing predicate if extracted: put the
0→1 detection in `firstLikeCrossed(prev: number, next: number): boolean` inside
feedSort.ts? NO — different concern; new export in suggestFollows.ts is wrong
file; make it a 3-line exported function in GMatchFeed's own module bottom + one
vitest `it('firstLikeCrossed')`. (If GMatchFeed isn't importable without a
hundred props, keep the helper in `src/components/feed/feedSort.ts` renamed
module `feedSignals.ts` — decide on first RED run, document choice in commit msg.)

Verify: vitest green (675 + new). Commit:
`git add ... && git commit -m "feat(feed): first-like flash on my posts"`

### Task 7 — loop-engineering pass (journey + screenshots + iterate)

Playwright scratch spec `e2e/nudge-journey.spec.ts` (delete-or-promote after):
1. `seedApp(page)` → goto `/#/feed` → assert default pill aria state = For You
   active (`getByRole('button', { name: 'For You' })` has the active class
   `bg-glass-w12`).
2. Feed empty (no mockBooruFeed server posts) → assert
   `/Empty in here/` visible → click upload button → creator modal opens
   (`data-testid` or the existing modal heading query — read
   `CreatePostModal`/`showCreatePostModal` render first to pick a stable
   selector).
3. Click sidebar logout icon → confirm dialog appears → cancel → still logged in
   (user chip present); click again → confirm → expect onboarding picker renders
   (`OnboardingFlow` marker: getByText(/Choose your server/i) — verify actual
   text in `firstRun/OnboardingFlow.tsx` ServerStep before writing the selector).
4. Desktop + mobile (375px) screenshots of steps 1-2 into tmp/audit/.

Run `npx playwright test e2e/nudge-journey.spec.ts`. Iterate on selector/copy
findings in-place (this is the loop-engineering step; commit fixes as you find
them, one commit per finding). When green, PROMOTE the spec to
`e2e/journeys.spec.ts`-style permanence only if the journeys file has a natural
home; otherwise delete the scratch file and record its assertions into
ENGAGEMENT.md's "Verified flows" section.

### Task 8 — gates

```
cd I:/goongrid/apps/desktop
npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run
npx playwright test e2e/journeys.spec.ts   # existing journeys must not regress (logout now reachable from sidebar -> check no journey clicked the settings path)
grep -rhoE "z-\[[0-9]{3,}\]|text-\[(6|7|8|9|11)px\]|rounded-3xl|duration-(75|100|200|1000)\b" src --include=*.tsx | wc -l   # 0
```
API untouched this wave → apps/api gates not required (note in final report).

## Risks, tradeoffs, open questions

- 'trending' as the DEFAULT flips every user's landing sort silently. Mitigated
  by persistence (choice sticky per install) and by the tab rename making it
  obvious. This is the industry-standard default (IG/TikTok); call it out in the
  PR description so it's a visible decision, not a sneak.
- Server `?sort=trending` + client affinity re-rank are two scorers; divergence
  was already true for today's 'trending' users (client re-sorts everything at
  GMatchFeed:353), so no new inconsistency. Kill one later if it drifts — flag,
  not fix, today.
- Follow suggestions use `followers_count` as tie-break, so unpopular servers
  show the same 3 people repeatedly. Accepted ceiling (ponytail comment in file).
- First-like flash is session-local: cross-session first likes get no celebration
  until a server `first_like` notifier exists (needs migration + tests; separate
  wave if the data says the flash gets seen).
- Open question (defaults chosen): the nudge card shows whenever the GLOBAL feed
  is empty, not only for users with zero own-posts. Alternative (per-user empty
  home) = a 'For You' filter for my-follows-first, much bigger lift. Defaults to
  global-empty; revisit when feed density grows.
- Logout confirm dialog is IdentityModal's existing 'Sign out?' step — sidebar
  button must NOT skip it (destruction-confirm basic, ponytail's never-lazy list).
