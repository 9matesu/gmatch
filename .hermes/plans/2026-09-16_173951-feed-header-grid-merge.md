# Feed Header / Grid Merge Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Move the feed column picker (1–5) into the `FeedHeader` next to Search, drop the redundant "Timeline" title, and render the header ABOVE the stories tray.

**Architecture:** Three surgical edits. `FeedHeader.tsx` already exposes a `colsControls?: React.ReactNode` slot (line 13) rendered immediately left of the search button — the plumbing exists; nothing new is designed. `GMatchFeed.tsx` currently renders stories → `<FeedHeader>` → density bar (post count + the 1–5 picker). We pass the picker node into the existing `colsControls` slot, delete the picker from the density bar, and reorder the two top blocks so the header is first. `App.tsx` is untouched: its collapse-only module header (`{collapsedModules.feed && ...}`) is a different state and stays.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (jsdom), Tailwind tokens (`bg-glass-*`, `text-retro-*`), Phosphor icons.

---

## Current context / assumptions

Read these first, do not skip:

- `I:/goongrid/apps/desktop/src/components/feed/FeedHeader.tsx` — 75 lines. Line 29-31 renders `<span>Timeline</span>`; line 36 renders `{colsControls}`; line 38-46 the Search button; line 48-59 Notifications.
- `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.tsx` — 1255 lines.
  - Line 556 wrapper `<div className="w-full flex flex-col font-sans select-none pb-12 text-retro-fg">`.
  - Line 557-570 stories tray block (first child).
  - Line 572-597 `<FeedHeader ...>` call (second child). Receives `unreadCount`, `onOpenSearch`, `onOpenNotifications`, `sortTabs`. Does NOT pass `colsControls`.
  - Line 600-625 density bar: `<span>{displayPosts.length} posts</span>` + the `['1','2','3','4','5']` picker (line 607-623).
  - Props `feedCols?: '1'|'2'|'3'|'4'|'5'` (default `'1'`, line 139) and `onFeedColsChange?: (cols) => void` (line 140, 185) already exist.
- `I:/goongrid/apps/desktop/src/App.tsx` line 3400-3413 — module wrapper; the "Timeline" text there renders ONLY when `collapsedModules.feed` is true. Leave it alone.
- `I:/goongrid/apps/desktop/src/App.tsx` line 3510-3511 — passes `feedCols={settings.feedCols}` and `onFeedColsChange`. Already wired.

**Interpretation of "o header deve substituir o atual cabeçalho, Timeline (subtitulo)":** drop the plain "Timeline" label span from `FeedHeader`; the bar itself becomes the heading. The `sortTabs` (For You / Latest) stay — they are functional, not decorative. If the user wants them gone too, that is a one-line follow-up. **Open question, default chosen:** keep sort tabs.

**Assumption:** the `1–5` picker controls the *feed* grid (columns of the post list), not the Clicker `1x1/1x2/2x2/3x3` pill. The Clicker pill lives on `CommandIsland.tsx` (line 249-275) and is untouched.

---

## Step-by-step tasks

### Task 1: Write the failing integration test

**Objective:** Pin the desired DOM shape before touching any component.

**Files:**
- Create: `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.header.test.tsx`

**Step 1: Write the test**

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { GMatchFeed } from './GMatchFeed';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() { } unobserve() { } disconnect() { }
  });
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('GMatchFeed header layout', () => {
  const identity = { orbitId: 'me', publicKeyHex: '1', privateKeyHex: '2' };

  const renderFeed = () =>
    render(
      <GMatchFeed
        identity={identity as never}
        posts={[]}
        stories={[]}
        users={[]}
        feedCols="2"
        onFeedColsChange={vi.fn()}
      />,
    );

  it('renders the FeedHeader as the very first element of the feed', () => {
    const { container } = renderFeed();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.firstElementChild?.tagName.toLowerCase()).toBe('header');
  });

  it('puts the 1-5 column picker inside the header, exactly once', () => {
    const { container } = renderFeed();
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header!.querySelector('[aria-label="3-column feed"]')).toBeTruthy();
    expect(container.querySelectorAll('[aria-label="3-column feed"]').length).toBe(1);
  });

  it('drops the plain "Timeline" label from the header', () => {
    const { container } = renderFeed();
    const header = container.querySelector('header') as HTMLElement;
    expect(header.textContent).not.toContain('Timeline');
  });
});
```

**Step 2: Run it to verify failure**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed/GMatchFeed.header.test.tsx
```

Expected: **3 failed**. Test 1 fails (`firstElementChild.tagName` is `'div'`, the stories tray). Test 2 fails (`header` exists but contains no `[aria-label="3-column feed"]` — the picker is still in the density bar). Test 3 fails (`header.textContent` contains `"Timeline"`).

Do not proceed until all three fail for those reasons.

---

### Task 2: Remove the "Timeline" label from FeedHeader

**Objective:** The bar becomes the heading; no plain title text.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/feed/FeedHeader.tsx:28-33`

**Step 1: Delete the label span**

Replace:

```tsx
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-sans font-semibold text-sm text-retro-fg select-none">
          Timeline
        </span>
        {sortTabs}
      </div>
```

with:

```tsx
      <div className="flex items-center gap-2 shrink-0">
        {sortTabs}
      </div>
```

**Step 2: Typecheck**

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit
```

Expected: exit 0, no output.

**Step 3: Do NOT commit yet** — this task alone breaks nothing but the change is meaningless without Task 3. Commit at the end of Task 3.

---

### Task 3: Move the picker into the header and hoist the header above stories

**Objective:** One bar at the top of the feed, picker beside Search, stories below it.

**Files:**
- Modify: `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.tsx:555-625`

**Step 1: Reorder — stories AFTER the header, and pass `colsControls`**

Replace the whole block from line 555 (`return (`) through line 625 (the closing `</div>` of the density bar) with:

```tsx
  return (
    <div className="w-full flex flex-col font-sans select-none pb-12 text-retro-fg">
      {/* Feed Top Header — the only bar: sort tabs, grid 1-5, search, alerts.
          Sits ABOVE the stories tray so it is the first thing in the tab. */}
      <FeedHeader
        unreadCount={unreadCount}
        onOpenSearch={() => setShowExploreSearch(true)}
        onOpenNotifications={() => {
          if (onOpenNotifications) onOpenNotifications();
          onRefreshNotifications?.();
        }}
        sortTabs={
          <div className="flex items-center gap-1 text-xs">
            {(['latest', 'trending'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { playPress(720); onFeedSortChange?.(mode); }}
                className={`px-3 py-1.5 rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedSort === mode
                    ? 'bg-glass-w12 text-retro-fg shadow-xs border border-border-glass'
                    : 'text-retro-muted hover:text-retro-fg'
                  }`}
              >
                {FEED_SORT_LABELS[mode]}
              </button>
            ))}
          </div>
        }
        colsControls={
          <div
            role="group"
            aria-label="Feed columns"
            className="flex items-center rounded-md bg-glass-w5 border border-border-glass p-0.5 text-xs"
          >
            {(['1', '2', '3', '4', '5'] as const).map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => { playPress(720); onFeedColsChange?.(cols); }}
                aria-pressed={feedCols === cols}
                title={`${cols}-column feed`}
                aria-label={`${cols}-column feed`}
                className={`px-2 py-1 rounded transition-all duration-150 active:scale-[0.96] cursor-pointer font-medium ${feedCols === cols
                    ? 'bg-retro-accent text-retro-accent-text font-semibold'
                    : 'text-retro-muted hover:text-retro-fg'
                  }`}
              >
                {cols}
              </button>
            ))}
          </div>
        }
      />

      {/* Stories Tray Carousel — below the header */}
      <div className="bg-transparent border-b border-border-glass py-3 px-1">
        <GMatchStories
          stories={stories}
          loading={storiesLoading}
          currentUserId={identity?.orbitId || ''}
          identity={identity}
          activeUserId={activeStoryUserId}
          onCloseActiveUser={onActiveStoryClose || (() => {})}
          onAddStory={onAddStory || (() => setShowCameraModal(true))}
          profilePics={profilePics}
          onStartPm={onStartPm}
        />
      </div>

      {/* Feed Content Column (Posts) */}
      <div className="w-full max-w-[1400px] mx-auto flex flex-col px-2 sm:px-4 py-2 space-y-3">
        {/* Density bar: post count only — the column picker moved to the header */}
        <div className="flex items-center justify-end px-3 sm:px-6 py-1 border-b border-border-glass">
          <span className="text-xs text-retro-muted">
            {displayPosts.length} posts
          </span>
        </div>
```

Note: the first-level `{/* Feed Posts List ... */}` block at old line 627 follows immediately after and is unchanged.

**Step 2: Typecheck**

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit
```

Expected: exit 0, no output.

**Step 3: Run the new test to verify pass**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed/GMatchFeed.header.test.tsx
```

Expected: **3 passed**.

**Step 4: Run the whole feed suite**

```bash
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed
```

Expected: all files pass. Pre-existing count was 14 files / 48 tests; this adds 1 file / 3 tests → **15 files / 51 tests**.

**Step 5: Run the design gate**

```bash
cd I:/goongrid/apps/desktop && bash design-gates.sh 2>&1 | tail -12
```

Expected: identical to baseline — 3 off-scale, 1 rounded-2xl, 1 white-alpha (pre-existing), none of them introduced by this change. If `bg-glass-w5` or `bg-glass-w12` shows up as a new violation, swap it for the token the gate accepts and re-run.

**Step 6: Commit**

```bash
cd I:/goongrid && git add apps/desktop/src/components/feed/FeedHeader.tsx apps/desktop/src/components/feed/GMatchFeed.tsx apps/desktop/src/components/feed/GMatchFeed.header.test.tsx && git commit -m "feat(feed): grid picker lives in the header; header sits above stories

The 1-5 column picker was a second bar below the stories while the header
bar already had a colsControls slot next to Search. Wire the picker into
that slot, drop the redundant 'Timeline' label (the bar is the heading),
and render the header before the stories tray so the tab leads with its
controls. Density bar keeps the post count."
```

---

## Tests / validation

Run in this order after the commit:

```bash
cd I:/goongrid/apps/desktop && npx tsc --noEmit && echo TSC_OK
cd I:/goongrid/apps/desktop && npx vitest run src/components/feed
cd I:/goongrid/apps/desktop && bash design-gates.sh
```

Expected:
- `TSC_OK`
- feed suite all green, 15 files
- design-gates output equals the baseline run (no new violations)

Optional full-desktop gate (slower, ~30s):

```bash
cd I:/goongrid/apps/desktop && npx vitest run
```

Expected: 138 files / 929 tests passed (was 137 / 926 before this change).

---

## Risks, tradeoffs, and open questions

- **Sticky header position.** `FeedHeader` uses `sticky top-0 z-30`. It was already sticky below the stories; hoisting it above the stories keeps the same containment, so scroll behavior should be unchanged. Verify visually in `npm run dev` — if the header sticks over the stories and looks odd, add a `relative` offset or accept it (the point of moving it up was persistent access to the controls).
- **Sort tabs kept.** "Timeline (subtitulo)" was read as the title + sort tabs; the plan drops only the title. If the user meant "drop the sort tabs too," delete the `sortTabs=` prop from the `<FeedHeader>` call — one-line change, and update the test's `header.textContent` assertion if it also should reject `"For You"`.
- **`App.tsx` collapsed-module header.** The "Timeline" text at `App.tsx:3403` renders only when the feed module is collapsed — it is the expand affordance, not the tab header. Untouched by design; do not remove it or the collapsed state loses its label.
- **The `bg-glass-w5` container** for the picker mirrors `CommandIsland.tsx:254` so both pickers read as siblings. If the design gate rejects it, use `bg-surface-interactive`.
- **Open question:** should the post count also move to the header? Not requested; left in the density bar. One line to move it later.
- **No runtime verification.** This plan is DOM-shape only. The visual result must be confirmed in the running app (`npm run dev`, which proxies `^/api` to `https://gmatch.fly.dev`).

---

## Files likely to change

- `I:/goongrid/apps/desktop/src/components/feed/FeedHeader.tsx` — delete 3 lines (the "Timeline" span).
- `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.tsx` — reorder two blocks, add `colsControls` node, delete the picker from the density bar.
- `I:/goongrid/apps/desktop/src/components/feed/GMatchFeed.header.test.tsx` — new, 3 tests.

Not touched: `App.tsx`, `CommandIsland.tsx`, `GMatchStories.tsx`, `useSettings.ts` (`feedCols` already persisted and passed through).