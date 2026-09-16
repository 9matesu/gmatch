# Fix: Watch tab browse view is not clickable (START A PARTY / Join / room rows dead)

## Goal

Make the Watch tab's browse view (room list) respond to clicks again: START A
PARTY opens the WatchPartyUrlModal, the room-code Join button joins, and
clicking an open-room row joins the room.

## Current context / assumptions

Repo: `I:\goongrid` (monorepo). Renderer: `apps/desktop` (Vite + React 19 +
Tailwind). Watch tab lives in:

- `apps/desktop/src/App.tsx` — the Watch theater wrapper (a fullscreen
  absolutely-positioned overlay) at ~line 4228.
- `apps/desktop/src/components/watchparty/WatchPartyView.tsx` — the tab
  content; browse mode renders `WatchPartyRoomList`.
- `apps/desktop/src/components/watchparty/WatchPartyRoomList.tsx` — the room
  list with START A PARTY (line 54), Join (line 69), and per-room buttons
  (line 86-98).
- `apps/desktop/src/components/watchparty/WatchPartyUrlModal.tsx` — the modal
  that should open from START A PARTY; renders via
  `apps/desktop/src/components/Modal.tsx` at `fixed inset-0 z-[var(--z-modal)]`.

Evidence traced this session (all verified in code):

- The Watch theater wrapper in `App.tsx` at 4228 is `absolute … z-[5]` on
  main (commit `c95f80d`).
- In the same stacking context, the app shell
  `<div className="app-glass relative z-10 …">` at `App.tsx:3320` covers the
  whole viewport and paints at **z-10 — ABOVE the theater (z-5)**.
- On the Watch tab, no view renderer matches `mainView === 'watch'` (see the
  comment at `App.tsx:3743`), so the app shell renders **empty** — you can see
  the theater through it, but the shell div is still the topmost DOM node at
  every pixel it covers, and it has no click handler. Every click on the
  room list lands on the shell instead of the buttons.

There is currently an **UNCOMMITTED, UNVERIFIED speculative change** in the
working tree that bumps the theater's z-index from `z-[5]` to `z-20` (both
branches of the ternary at `App.tsx:4231-4232`). Current diff:

```
-                    ? 'absolute inset-0 z-[5] flex flex-col min-h-0 overflow-hidden'
-                    : 'absolute inset-x-0 top-9 bottom-[var(--island-clearance)] z-[5] flex flex-col min-h-0 overflow-hidden')
+                    ? 'absolute inset-0 z-20 flex flex-col min-h-0 overflow-hidden'
+                    : 'absolute inset-x-0 top-9 bottom-[var(--island-clearance)] z-20 flex flex-col min-h-0 overflow-hidden')
```

That change is the leading hypothesis for the fix, but it has never been
exercised by a real click. Task 1 verifies it in a browser; if it doesn't
hold, Task 1's diagnostic names the real blocking element and Task 3 fixes
that instead.

Assumptions:

- Dev server boots at `http://localhost:5173` (or the next free port; check
  the `Local:` line printed by `npm run dev`).
- Playwright is installed: `apps/desktop/package.json` has
  `@playwright/test@^1.62.1` and `apps/desktop/playwright.config.ts` exists.
- The `seedApp` helper in `apps/desktop/e2e/helpers.ts` seeds a fully
  onboarded identity with an empty watch state — same helper used by the
  existing suites.

## Architecture / proposed approach

One-line className change at `App.tsx:4231-4232`: give the Watch theater a
z-index that beats the app shell's `z-10` (i.e. `z-20`), so its DOM is the
topmost hit target in browse mode. Prove it with a new Playwright spec
(`apps/desktop/e2e/watch.spec.ts`) that hit-tests the START A PARTY button
with `document.elementFromPoint`, clicks it, and asserts the Watch Party
modal opens — plus a second test that the Join button with a bad code shows
the inline error (proves the input and Join are wired).

## Step-by-step tasks

### Task 1 — Reproduce + capture the blocker (diagnostic, not committed)

Files: none (throwaway under `apps/desktop/tmp/`).

Commands:

```
cd /i/goongrid/apps/desktop
npm run dev          # leave running; note the printed Local: URL (5173, 5174, …)
```

Write `apps/desktop/tmp/diag-watch.spec.ts` (throwaway):

```ts
import { test } from '@playwright/test'
import { seedApp } from '../e2e/helpers'

test('diagnostic: who owns the START A PARTY pixel?', async ({ page }) => {
  await seedApp(page)
  await page.goto('http://localhost:5173/#/watch')
  await page.waitForTimeout(1500)
  const btn = page.getByRole('button', { name: /START A PARTY/i })
  await btn.waitFor({ state: 'visible' })
  const box = await btn.boundingBox()
  const hit = await page.evaluate(
    ([x, y]: [number, number]) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const chain: string[] = []
      let cur: HTMLElement | null = el
      while (cur && chain.length < 8) {
        chain.push(`${cur.tagName}.${(cur.className || '').toString().slice(0, 80)}`)
        cur = cur.parentElement
      }
      return { top: el?.outerHTML.slice(0, 200), chain }
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  )
  console.log(JSON.stringify(hit, null, 2))
})
```

Run:

```
npx playwright test tmp/diag-watch.spec.ts --reporter=list 2>&1 | tail -40
```

Expected BEFORE any fix (i.e. against `main`, or after `git stash` of the
z-20 change):

- `chain[0]` (topmost) is NOT the START A PARTY button; it is a
  `DIV.app-glass …` (or another full-viewport sibling).
- This confirms the app shell absorbs the click.

Expected AFTER the fix (with the z-20 change applied and HMR reloaded):

- `chain[0]` is the `<button>` whose text starts with `START A PARTY`, or a
  descendant of it.

If the topmost element is NOT the app shell (e.g. an unrelated overlay like
`ImageViewer`, `UserProfileModal`, a notifications modal, or the lobby
lightbox), skip Task 3's z-index change and fix whatever overlay is stuck
mounted — see Risks.

Delete `apps/desktop/tmp/diag-watch.spec.ts` before committing.

### Task 2 — Write the failing E2E test (RED)

File (new): `apps/desktop/e2e/watch.spec.ts`.

```ts
import { test, expect } from '@playwright/test'
import { seedApp } from './helpers'

test.describe('Watch tab — browse view clickability', () => {
  test('START A PARTY opens the Watch Party modal', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const btn = page.getByRole('button', { name: /START A PARTY/i })
    await expect(btn).toBeVisible()

    // Hit-test: the button (or a descendant) must be the topmost element at
    // its own center pixel.
    const box = await btn.boundingBox()
    const topText = await page.evaluate(
      ([x, y]: [number, number]) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return (el?.closest('button')?.textContent || el?.tagName || '').trim()
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    )
    expect(topText.toUpperCase()).toContain('START A PARTY')

    await btn.click()
    // Modal.tsx renders an <h3> title; WatchPartyUrlModal passes 'Watch Party'.
    await expect(page.getByRole('heading', { name: 'Watch Party' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Video URL' })).toBeVisible()
  })

  test('Join button with a bad room code shows the inline error', async ({ page }) => {
    await seedApp(page)
    await page.goto('/#/watch')
    const input = page.getByRole('textbox', { name: 'Join by room code' })
    await expect(input).toBeVisible()
    await input.fill('00000000')
    await page.getByRole('button', { name: /^Join$/ }).click()
    await expect(page.getByText(/No room with that code/i)).toBeVisible()
  })
})
```

Notes:

- `page.goto('/#/watch')` requires `baseURL` in
  `apps/desktop/playwright.config.ts`. Verify with:

  ```
  grep -n "baseURL\|webServer" apps/desktop/playwright.config.ts
  ```

  If `baseURL` is undefined, replace `page.goto('/#/watch')` with
  `page.goto('http://localhost:5173/#/watch')` in both tests (adjust the port
  to the `Local:` line from Task 1).
- `WatchPartyRoomList` already labels the input `aria-label="Join by room
  code"` (line 61) and the button text is `Join` (line 69), so the getters
  above work without touching the component.

Run (RED), with the working tree restored to `main` first:

```
cd /i/goongrid
git stash push -- apps/desktop/src/App.tsx
cd apps/desktop
npx playwright test e2e/watch.spec.ts --reporter=list 2>&1 | tail -40
cd /i/goongrid && git stash pop
```

Expected:

- Test 1 FAILS at `expect(topText.toUpperCase()).toContain('START A PARTY')`
  (the topmost element is the app-shell div, so `topText` is `DIV` or
  `MAIN`), OR at `getByRole('heading', { name: 'Watch Party' })` if the click
  is swallowed silently and the modal never mounts.
- Test 2 FAILS at `expect(page.getByText(/No room with that code/i))`.

If both tests PASS on the stashed (pre-fix) tree, STOP: the diagnosis is
wrong — do not apply Task 3. Re-read `chain` in Task 1 and re-plan.

### Task 3 — Apply the fix (GREEN)

File: `apps/desktop/src/App.tsx`, around line 4231-4232.

Confirm the working tree already has the uncommitted change:

```
cd /i/goongrid
git diff -- apps/desktop/src/App.tsx
```

The diff must be exactly two lines, `z-[5]` → `z-20` on both branches of the
ternary. If the file has drifted (or was reverted), apply it with the patch
tool:

old_string (exact, two lines):

```
                    ? 'absolute inset-0 z-[5] flex flex-col min-h-0 overflow-hidden'
                    : 'absolute inset-x-0 top-9 bottom-[var(--island-clearance)] z-[5] flex flex-col min-h-0 overflow-hidden')
```

new_string:

```
                    ? 'absolute inset-0 z-20 flex flex-col min-h-0 overflow-hidden'
                    : 'absolute inset-x-0 top-9 bottom-[var(--island-clearance)] z-20 flex flex-col min-h-0 overflow-hidden')
```

Rationale (one line): the app-shell div at `App.tsx:3320` paints at `z-10`
and covers the viewport; the theater must exceed it to be the topmost hit
target in browse mode.

Optional hardening (only if Task 1's `chain` shows a **nested** overlay is
the blocker, not the shell): the theater may be confined by a stacking
context on an ancestor (`opacity < 1`, `transform`, `filter`,
`backdrop-filter`, `isolation`). In that case MOVE the theater OUT of that
ancestor — do not fight z-indexes.

Run (GREEN):

```
cd /i/goongrid/apps/desktop
npx playwright test e2e/watch.spec.ts --reporter=list 2>&1 | tail -40
```

Expected: `2 passed`.

Re-run the Task 1 diagnostic to confirm in the console the button is now the
topmost element (`top:` starts with `<button`).

### Task 4 — Non-Playwright gates

```
cd /i/goongrid/apps/desktop
npx tsc --noEmit                                 # expected: no output, rc=0
npx eslint src electron vite.config.ts 2>&1 | tail -3
# expected: a summary line ending in "0 errors" (warnings allowed)
npx vitest run 2>&1 | grep -E "Test Files|Tests " | head -3
# expected: "Test Files  136 passed (136)" / "Tests  913 passed (913)"
```

All three must be green before committing.

### Task 5 — Commit, PR, squash

```
cd /i/goongrid
rm -f apps/desktop/tmp/diag-watch.spec.ts
git status --short
# must show ONLY: M apps/desktop/src/App.tsx and ?? apps/desktop/e2e/watch.spec.ts
git checkout -b fix/watch-tab-click-20260916
git add apps/desktop/src/App.tsx apps/desktop/e2e/watch.spec.ts
git commit -m "fix(watch): theater above app shell so browse view is clickable"
git push -u origin fix/watch-tab-click-20260916
gh pr create --base main \
  --title "fix(watch): theater above app shell so browse view is clickable" \
  --body "Watch tab browse view was not clickable: the app-shell div (z-10) covered the theater (z-5) with no background paint, so users saw the room list through it but every click hit the shell. Bump theater to z-20 and lock it with an e2e hit-test + modal-open assertion. Verified: tsc 0, eslint 0 errors, vitest 913/913, playwright e2e/watch.spec.ts 2/2."
gh pr merge <n> --squash --delete-branch
cd /i/goongrid && git checkout main && git pull
```

Replace `<n>` with the PR number printed by `gh pr create`.

## Tests / validation

The Playwright spec is the RED-GREEN cycle:

- RED: `git stash push -- apps/desktop/src/App.tsx` →
  `npx playwright test e2e/watch.spec.ts --reporter=list` → both tests fail.
- GREEN: `git stash pop` (or re-apply the two-line patch) → re-run →
  `2 passed`.
- Regression: `npx vitest run` 913/913; `npx tsc --noEmit` rc=0;
  `npx eslint src electron vite.config.ts` 0 errors.

Unit tests are NOT applicable: the bug is a runtime stacking / containment
issue in the browser. The only honest proof is a real click in a real
browser — that is what the new spec provides.

## Risks, tradeoffs, and open questions

- **Losing the uncommitted z-20 by accident.** Do NOT `git checkout --
  apps/desktop/src/App.tsx` at any point — that drops the fix. Use
  `git stash push`/`git stash pop` (which was already the RED step above).
- **In-room fullscreen.** In-room mode renders the theater `absolute inset-0
  z-20`. CommandIsland is `fixed … z-[var(--z-dropdown)]` (40) in the same
  stacking context, so the island still wins and stays clickable. Confirm
  with a manual smoke: open a room, verify the island hovers / responds and
  the theater bleeds the video behind the transparent header.
- **Overlay stuck mounted.** If Task 1 shows the topmost element is a modal
  overlay (`ImageViewer`, `UserProfileModal`, notifications modal, lobby
  lightbox) rather than the app shell, the fix is different: null out the
  stuck flag on `handleSetMainView` (or gate the overlay to its own view) —
  do NOT blindly bump the theater's z-index.
- **Design contract on z values.** `docs/DESIGN.md` and
  `apps/desktop/src/globals.css:36` ban arbitrary 3+ digit z-index. `z-20`
  is fine; do not introduce `z-[999]` etc. If a modal inside the app shell
  ever needs to outrank the theater, move the modal OUTSIDE app-glass rather
  than raising its z-var above `--z-dropdown: 40`.
- **`overflow-hidden` clipping.** The theater is `overflow-hidden`; if a
  dropdown opens beyond its box it will clip. Not observed here; the pattern
  is to render modals via `<Modal>` (already `fixed inset-0`), not inline.
- **Open question — mount policy.** The theater is "always mounted, hidden
  off-tab" so a live room keeps playing in the background. If Task 1 reveals
  the hidden theater is itself clipping clicks on OTHER tabs (edge case), it
  would need a mount gate on `mainView === 'watch' || watchRoomOpen`. Not in
  scope unless Task 1 shows it.

## Files touched (expected)

- `apps/desktop/src/App.tsx` — two-line className change.
- `apps/desktop/e2e/watch.spec.ts` — new (RED→GREEN).
- Deleted before commit: `apps/desktop/tmp/diag-watch.spec.ts`.