# Humanize gMatch: copy, feedback, flow

Date: 2026-09-11 07:11 (-0300). Repo: `I:/goongrid`, app: `apps/desktop` + `apps/api`.
Skills to apply while executing: `humanizer` (34 AI-tell patterns) and bencium
`bencium-impact-designer` + `typography` (both from github.com/bencium/bencium-marketplace —
read the two SKILL.md files once before starting; their raw URLs are in "Sources" below).
Ponytail mode: this is a DELETION-and-replacement sweep, not a framework. Zero new deps,
zero new abstractions.

## Goal

Make every user-visible string and every feedback beat in gMatch read like a person wrote
them at a desk, not like a model generated them: no "successfully", exclamation budget,
errors that say what happened and what to do, empty states with a pulse.

## Current context (verified)

- Copy surface, measured this session:
  - ~266 distinct JSX text strings ≥12 chars in `src/components|firstRun|game|ui`.
  - ~120 distinct `toast('...')` literals; the top offender is `toast('Network error')`
    with **8 call sites** (shared generic fallback — fix at the sites, there is no shared
    helper to fix; grep `toast('Network error'` to list them).
  - 30+ success toasts ending in `!` ("Post published successfully!", "Copied Link!",
    "Done!"...). Humanizer pattern 18/31 + bencium "budget ONE exclamation".
  - `src/utils/gameAds.ts` `GAME_AD_TEMPLATES` — promotional taglines ("unlock exclusive
    supporter badges & perks", "Deploy your deck. Climb the league. Crush your rivals."
    = rule-of-three staccato, pattern 10/31).
  - Server notification strings in `apps/api/src/notifications.ts` ("Challenge declined",
    "Failed to start the match", "Invite not found").
  - Empty states: `src/components/feed/GMatchFeed.tsx:940` "No Posts Yet" (title-case
    heading, pattern 17), `src/components/profile/GMatchProfile.tsx:356` "No posts yet",
    `src/components/Skeleton.tsx:36` "Loading...", `GMatchDMs.tsx:711` "Loading...".
- The guided tour (`src/firstRun/tourState.ts`, shipped today) is ALREADY humanized and
  its test enforces ASCII-only copy (`tourState.test.ts`, the `/^[\x20-\x7E]+$/` assert).
  Do not curly-quote or emoji-fy it; leave it out of the sweep.
- Design contract `docs/DESIGN.md` stays in force (tokens, z-scale, 3 durations, lucide
  only). The V1 acceptance greps must stay green after this sweep.
- House pitfalls that bind this plan:
  - sed + apostrophes corrupts JS quoting (documented). All copy edits via the `patch`
    tool or python, never sed.
  - Some vitest files assert on copy strings. After each task run the touched project's
    tests and update assertions in the SAME commit.
  - opencode parallel agent may share the worktree: commit explicit paths only.
  - CRLF mix: use the incremental-file-editing newline-preserving recipe.

## Deliberately skipped (say so, don't rebuild)

- Curly-quote mass conversion (bencium typography rule). The repo's own humanizer skill
  flags curly quotes as an AI tell in chat-adjacent UI, the sed hazard is documented, and
  the value is near zero on a dark zinc app. Skipped. Add only per-string if the user
  asks for typographic polish later.
- `...` → `…` ellipsis: apply ONLY where the string is visible JSX text (4 known sites,
  listed in Task 5). Not a global regex.
- New i18n layer, copy lint tooling, CMS for strings: rung 1, no.

## Architecture

Five sweep tasks, each: grep the surface → apply the rewrite table below (verbatim) →
fix any test assertions that quote the old string → gates → commit. The rewrite table IS
the taste decision; the implementer pastes, not composes. Anything not in the table gets
rewritten by the rules in "Copy rules" and lands in the same commit.

## Copy rules (from humanizer + bencium, distilled to what's checkable)

1. No "successfully", no "Please", no "Oops/Uh oh" theater. "Post published successfully!"
   → "Posted."
2. Exclamation budget: one per screen, only for genuine game moments (Victory! stays).
   Every CRUD toast loses its `!`.
3. Errors name the thing and the next move. "Network error" → what failed + what happens
   next ("Couldn't reach the server. Retrying in a bit." only if it actually retries —
   check the call site; if it doesn't retry, say "Check your connection.").
4. No rule-of-three ad copy in gameAds ("Deploy your deck. Climb the league. Crush your
   rivals." → two sentences max, one concrete).
5. Headings sentence-case ("No Posts Yet" → "No posts yet").
6. Empty states get one honest line, no hype, no reassurance kicker ("And that's okay!"
   is banned by pattern 34).
7. Buttons stay verb-first, 1-3 words. No "Go ahead and X".
8. Contractions allowed and encouraged in prose strings ("Couldn't", "You're"). Banned
   only where the repo test asserts ASCII (tourState).

## Tasks

### Task 0 — inventory file (5 min, no commit)

```
cd I:/goongrid/apps/desktop
grep -rn "toast('" src --include=*.tsx --include=*.ts | grep -v test > ../../docs/toast-inventory.txt
grep -rnE ">[A-Z][^<>{}]{4,120}<" src/components src/firstRun src/game src/ui --include=*.tsx | grep -v test > ../../docs/jsx-text-inventory.txt
```
Expected: two files, ~120 and ~270 lines. These are the work list; the rewrite table
covers the high-traffic entries, the rules cover the tail. Delete both files before the
final commit (they're scratch, not docs).

### Task 1 — toast sweep (the big one)

File: many. Use `patch` per string. Complete rewrite table (old → new, verbatim):

| old | new |
|---|---|
| `Network error` (all 8 sites) | `Couldn't reach the server.` — then per site, if the code retries or has a fallback, append the truth (e.g. ` Check your connection.`). Grep each site's catch block first; do not promise a retry that doesn't exist. |
| `Post published successfully!` | `Posted.` |
| `Posted to your feed!` | `Posted to your feed.` |
| `Post shared to your profile feed!` | `Shared to your profile.` |
| `Post shared to gMatch!` | `Shared.` |
| `Post link copied to clipboard!` | `Link copied.` |
| `Copied Link!` | `Link copied.` |
| `Comment posted!` | `Comment posted.` |
| `Profile picture updated!` | `Profile picture updated.` |
| `Unique card created!` | `Card created.` |
| `Deck set as active for duels!` | `Deck active for duels.` |
| `Invite sent!` | `Invite sent.` |
| `Image card sent successfully!` | `Card sent.` |
| `Flash sent to everyone online!` | `Flash sent to everyone online.` |
| `Logged in to gMatch!` | `Logged in.` |
| `Done!` | `Done.` |
| `Diagnostic logs copied to clipboard!` | `Logs copied.` |
| `Snapshot captured and attached!` | `Snapshot attached.` |
| `Your account is ready to play!` | `Account ready.` |
| `You joined the round!` | `You joined the round.` |
| `Story liked! +10 g$` | keep (game moment, the `!` is earned) |
| `Match Started!` | `Match started.` |
| `Victory!` | keep (game moment) |
| `Tags must be added before uploading post!` | `Add at least one tag first.` |
| `Please remember to save or download your secret key before quitting so you do not lose account access!` | `Save or download your secret key before quitting. Without it, the account is gone.` |
| `Recommendation submitted! Thank you.` | `Recommendation submitted.` |
| `Conviction Boost cast!` | keep (game moment) |
| `Virus lock expired! System restored.` | `Virus lock expired. System restored.` |
| `Refreshing gallery` family: `Refreshed gallery` | keep (already flat) |
| `Unregistered` | `Server unregistered.` |
| `Updating profile picture...` | `Updating profile picture…` |
| `Preparing image…` | keep |
| `Story upload failed - try again.` | `Story upload failed. Try again.` |
| `That file is not valid JSON` | keep (specific, honest) |
| `Could not load the image` | keep |
| `This server has no address to join (owner is offline?)` | keep (the question mark is real uncertainty, human) |
| `Server registered — it is listed for signed-in explorers` | `Server registered. Signed-in users can see it in the directory.` (em-dash out, pattern 14) |
| `Secret key copied — store it somewhere outside gMatch.` | `Secret key copied. Store it somewhere outside gMatch.` |
| `Snapshot exported — keep the file safe` | `Snapshot exported. Keep the file somewhere safe.` |
| `Your local server is still starting — the claim retries automatically` | `Local server is still starting. The claim retries on its own.` |
| `Server password is wrong — open Servers to re-enter it` | `Wrong server password. Re-enter it in Servers.` |
| `Returning to your own server — the app restarts` | `Returning to your own server. The app restarts.` |
| `This computer already administers a different server — create canceled` | `This computer already runs a server. Create canceled.` |
| `Reported — content hidden pending admin review` | `Reported. Content hidden until an admin reviews it.` |
| `Replies/attachments over the courier need a direct connection — send text for now` | `Replies and attachments need a direct connection. Send text for now.` |
| `Server renamed locally; directory update failed` | `Server renamed here, but the directory didn't update.` |
| `Server renamed locally; directory is offline` | `Server renamed here. The directory is offline.` |
| `The spy session ran out of time.` | keep |
| `You must have at least one provider in the pool` | `Keep at least one provider in the pool.` |

Any toast NOT in the table: apply rules 1-3 and 8. If a string is already flat and
specific, leave it alone — the sweep must not become churn.

Verification (exact):
```
cd I:/goongrid/apps/desktop
grep -rn "successfully\|Successfully" src --include=*.tsx --include=*.ts | grep -v test | grep -iE "toast|alert|message"   # expect: no matches
grep -rn "toast('[A-Z][^']*!'" src --include=*.tsx | grep -vE "Victory|Story liked|Conviction"                            # expect: no matches
npx vitest run   # fix any assertion that quoted an old string, same commit
```
Commit: `git add <explicit touched files> && git commit -m "copy: humanize toast feedback"`

### Task 2 — gameAds taglines

File: `src/utils/gameAds.ts`. Rewrite the promotional templates (keep keys/gradients/
icons untouched — copy only):

| field | old | new |
|---|---|---|
| coffee.tagline | `Support gMatch development and unlock exclusive supporter badges & perks.` | `Support development. Supporters get badges and a few perks.` |
| duel.tagline | `Deploy your deck. Climb the league. Crush your rivals.` | `Run your deck up the league table.` |
| discord.tagline | `Join our community server, meet other creators, and get live updates.` | `Community server. Updates land there first.` |
| badge `SUPPORT US` | keep (two words, fine) |
| ctaLabel values | keep (already verb-first) |

Read the full file first; apply the same rules to any template not listed.
Verify: `npx vitest run src/utils` green; `grep -c "Crush your rivals" src/utils/gameAds.ts` → 0.
Commit: `git add apps/desktop/src/utils/gameAds.ts && git commit -m "copy: game ad taglines, less ad"`

### Task 3 — server notification strings

File: `apps/api/src/notifications.ts` (and grep siblings:
`grep -rn "title:\|body:" apps/api/src --include=*.ts | grep -v test`).
Known rewrites: `Challenge declined` → keep (flat, fine). `Failed to start the match` →
`The match couldn't start.` `Invite not found` → keep (specific). Apply rules 1-3 to the
rest. Server strings render in the client's grouped notifications, so keep them under
~60 chars.
Verify: `cd I:/goongrid/apps/api && npx vitest run` green (update assertions in same commit).
Commit: `git add apps/api/src/notifications.ts <siblings> && git commit -m "copy: humanize server notifications"`

### Task 4 — empty states and headings

Files + exact edits:
- `src/components/feed/GMatchFeed.tsx:940`: `No Posts Yet` → `No posts yet`, and add
  under it (match the existing muted class in that block):
  `<p className="text-xs text-retro-muted mt-1">Tags you pick feed this page. Add one from the bar above.</p>`
  (read the surrounding JSX first; if a hint line already exists, only fix the case).
- `src/components/profile/GMatchProfile.tsx:356`: if it's bare "No posts yet", append
  one honest line: `Nothing posted here yet.` (no hint needed, it's someone else's profile).
- Title-case sweep on JSX headings:
  `grep -rnE "<h[2-4][^>]*>[A-Z][a-z]+ [A-Z][a-z]+[^<]*</h" src --include=*.tsx | grep -v test`
  → sentence-case each hit (pattern 17). Skip proper nouns (Discord, gMatch, Admin Panel
  as a product name is borderline — leave "Admin Panel").
Verify: `npx vitest run src/components/feed src/components/profile` green.
Commit: `git add <files> && git commit -m "copy: sentence-case headings, honest empty states"`

### Task 5 — loading copy + ellipsis (tiny)

- `src/components/Skeleton.tsx:36`: `Loading...` → `Loading…`
- `src/components/chat/GMatchDMs.tsx:711`: `'Loading...'` → `'Loading…'`
- `src/components/AttachmentUploadModal.tsx:291`: `'Uploading...'` → `'Uploading…'`
- Grep the tail for stragglers in visible text only:
  `grep -rn "\\.\\.\\.'" src --include=*.tsx | grep -vE "test|// |\.\.\.\)" | head`
  (three-dot inside JSX string literals → `…`; spread operators `...x` stay).
Verify: `npx vitest run src` green.
Commit: `git add <files> && git commit -m "copy: real ellipsis in loading states"`

### Task 6 — interaction/flow pass (judgment task, bounded)

Walk these five flows in dev (`npm run dev` in apps/desktop, vite :5173, sidecar :8790;
set ADMIN_PIN in the launching shell) and fix ONLY what reads machine-made. Budget: max
~10 small edits, each a string or a missing feedback beat, no layout changes.

1. First post: create → publish. Does the user get any acknowledgment beyond the toast?
   (If the modal just vanishes, that's fine — don't add confetti.)
2. Skip a feed image: silent is correct. Do NOT add feedback.
3. Idle drain/purge: check the +g$ float and eviction feel honest (numbers match).
4. Duel end screen: payout text truthful per `matchEconomy` (already spec'd; verify copy
   reads human, e.g. "You won 140 g$" not "Congratulations on your victory!").
5. Server join relaunch: the "the app restarts" warning must appear BEFORE the relaunch
   click, not after.

Each fix: patch → `npx vitest run <touched test dir>` → commit `copy: <flow> feedback beat`.
If a flow already feels human, write one line in the PR-style commit message and move on.
Zero edits here is a valid outcome.

### Task 7 — gates

```
cd I:/goongrid/apps/desktop
npm run lint                      # 0 errors
npx tsc --noEmit -p tsconfig.json # 0 errors
npx vitest run                    # all green (~675 baseline)
cd ../api && npx vitest run       # all green (~840 baseline)
cd ../.. && grep -rn "successfully" apps/desktop/src apps/api/src --include=*.ts --include=*.tsx | grep -v test | grep -viE "test\.|// "   # expect empty
rm docs/toast-inventory.txt docs/jsx-text-inventory.txt
```
DESIGN.md acceptance greps (token-only, z-scale, durations) must be unchanged — this
sweep touches no classes except the one added hint line in Task 4 (uses existing tokens).

## Tests / validation notes

- This is a copy sweep: TDD per-task means "grep gate first (RED: old string present),
  patch (GREEN: grep empty), tests stay green, commit". No new test files — YAGNI; the
  existing suite's string assertions are the regression net, and updating an assertion to
  the new copy in the same commit is correct, not cheating.
- The tour ASCII assertion (`tourState.test.ts`) must keep passing — it's the tripwire
  against curly-quote creep.

## Risks, tradeoffs, open questions

- Risk: rewriting 100+ strings flattens personality along with the slop. Mitigation: the
  table preserves the app's dry voice ("Keep the file somewhere safe.", "Send text for
  now.") — flat but specific, which is the target.
- Risk: tests asserting old copy fail late. Mitigation: run vitest per task, not at the
  end.
- Tradeoff: server notification copy changes affect already-stored rows? No — titles are
  generated at insert time; old rows keep old text. Accepted (nobody files bugs about a
  toast from last week).
- Open question (non-blocking, default chosen): gameAds keeps its ad framing (it's an
  in-game ad gag) — only the slop comes out. If the user wants the ads gone entirely,
  that's a different, smaller PR.

## Sources

- humanizer skill: local (`creative/humanizer`), 34 patterns.
- bencium-impact-designer SKILL.md:
  https://raw.githubusercontent.com/bencium/bencium-marketplace/main/bencium-impact-designer/skills/bencium-impact-designer/SKILL.md
- bencium typography SKILL.md:
  https://raw.githubusercontent.com/bencium/bencium-marketplace/main/typography/skills/typography/SKILL.md
  (applied selectively; see "Deliberately skipped")
