# bencium design-audit applied to gMatch (visual pass, not a rebrand)

Date: 2026-09-11 08:44 (-0300). Repo: `I:/goongrid`, app: `apps/desktop`.
Method source: bencium-marketplace `design-audit` + `typography` +
`bencium-impact-designer` SKILL.md files (URLs in Sources).
Ponytail mode: the audit's Reduction Filter IS the ladder — "if an element can be
removed without losing meaning, it must be removed." Zero new deps, zero new
components beyond one prop change.

## Goal

Run the bencium design-audit protocol over gMatch's real surfaces and fix the
violations it catches (emoji icon chrome, letter-spacing on all-caps, prose line
length, DESIGN.md acceptance greps), then deliver a phased findings doc for the
judgment calls instead of silently redesigning anything.

## Current context (verified this session)

- The house design contract is `I:/goongrid/docs/DESIGN.md` (V1 standard: tokens
  only, 6-step type scale floor 10px, 4-step radius, z-scale CSS vars, 3 durations,
  lucide-only icons, "ZERO emoji/glyph in chrome", acceptance grep list that must
  read 0). The bencium skills must be applied INSIDE this contract, not against it
  — impact-designer's own rule: "Client brand already uses X? Use it brilliantly,
  don't force alternatives." The retro-glass zinc look is the chosen aesthetic;
  do NOT rebrand fonts, palette, or add grain/gradients/noise. The audit's scope
  is correctness and consistency, not a new direction.
- Copy was already humanized today (5 commits, see
  `.hermes/plans/2026-09-11_071130-humanize-copy-flow-sweep.md` git log). Do not
  touch strings.
- Measured violations to fix:
  - `src/components/EmptyState.tsx` takes `icon?: string` and renders it raw
    (`<span className="text-3xl opacity-40">{icon}</span>`) — callers pass EMOJI:
    `src/components/grid/IdleGalleryView.tsx:43` `icon="🖼️"` and `:84` `icon="🔍"`.
    That is a direct DESIGN.md icon-rule break (the acceptance grep list only names
    ❤️⚡★✕; the emoji rule is broader — the grep list is the floor, not the ceiling).
    12 files use EmptyState; enumerate with
    `grep -rn "<EmptyState" src --include=*.tsx -A2 | grep "icon="`.
  - All-caps text without letterspacing (bencium typography: caps ALWAYS get
    5-12% tracking): `grep -rn "uppercase" src --include=*.tsx | grep -v tracking |
    grep -v test` → 45 hits to triage (many will already inherit tracking from a
    parent class; only fix the ones where the uppercase text itself lacks it).
  - DESIGN.md acceptance greps themselves — run the full list from the "Acceptance
    greps" section of docs/DESIGN.md; any non-zero output is a fix in this sweep.
  - `transition-all` x110: bencium motion rule is "animations that delay user
    actions = never" — `transition-all` on hover/color is fine and NOT in scope.
    Skip; do not churn 110 lines.
  - z-10..z-50 legacy Tailwind values (~130 sites): DESIGN.md only bans 3+ digit
    arbitraries; the named-var convergence for 2-digit values was deliberately not
    required by the V1 contract. Skip; log as Phase 3 backlog in the findings doc.
- Bencium typography rules that gMatch ALREADY passes (verify, don't rebuild):
  kern/legibility + tabular nums (`MONO` recipe in `src/ui/styles.ts`), focus
  states (`*:focus-visible` in globals.css:182), reduced-motion kill switch
  (globals.css, per DESIGN.md), 2-font max (Outfit + JetBrains Mono), line-height
  on prose (`leading-relaxed`), sentence-case headings (swept today).

## Architecture

Four bite-sized fix tasks with grep-gates (each: RED grep → patch → GREEN grep →
vitest → commit), then one AUDIT task that produces
`docs/DESIGN-AUDIT-2026-09-11.md` in bencium's phased format (Phase 1 critical /
2 refinement / 3 polish) containing findings that are judgment calls or too big
for this wave — the doc is the deliverable there, per the skill's "wait for
approval" protocol. No implementation from the findings doc without a user go.

## Tasks

### Task 1 — EmptyState: emoji prop becomes lucide component

`src/components/EmptyState.tsx` — change the prop type and render:

```tsx
import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state space-y-3">
      {icon && <icon className="w-7 h-7 text-retro-muted opacity-60" strokeWidth={1.5} aria-hidden />}
      ...
```
(keep the rest of the component byte-identical; the old `<span className="text-3xl
opacity-40">{icon}</span>` line is the only render change.)

Then update every caller (enumerate first with the grep above). Known:
- `src/components/grid/IdleGalleryView.tsx:43`: `icon="🖼️"` → `icon={Image}` (import
  `Image` from lucide — collides with the DOM name, alias it: `import { Image as ImageIcon }` and pass `icon={ImageIcon}`).
- `src/components/grid/IdleGalleryView.tsx:84`: `icon="🔍"` → `icon={Search}`.
- Any remaining `icon="..."` string callers found by the grep: pick the lucide
  icon that matches the string's meaning; list the pick in the commit message.

RED/GREEN (exact):
```
cd I:/goongrid/apps/desktop
grep -rn 'icon="' src --include=*.tsx | grep -i emptystate -A0   # plus the -A2 pipeline above; must read 0 after
npx tsc --noEmit -p tsconfig.json                                  # must be 0 errors (string->component type break proves every caller migrated)
npx vitest run                                                     # 675 green; update any test asserting emoji icon text
```
Commit: `git add <touched files> && git commit -m "ui: EmptyState takes lucide icons, emoji chrome out"`

### Task 2 — letterspacing on all-caps micro-labels

For each hit of
`grep -rn "uppercase" src --include=*.tsx | grep -v tracking | grep -v test`:
if the uppercase element itself has no `tracking-*` AND no ancestor in the same
component obviously carries one, append ` tracking-wider` to that className.
bencium: caps are harder to read, ALWAYS 5-12%. DESIGN.md already names
`tracking-wider` as the house value — use it, never an arbitrary `tracking-[...]`.

Expected output: zero or near-zero hits remain:
```
grep -rn "uppercase" src --include=*.tsx | grep -v tracking | grep -v test | wc -l   # was 45; expect <5 (parent-inherited exceptions, note each with a comment? NO — no comments, just confirm by reading the parent chain)
```
Verify `npx vitest run` green. Commit per directory group if >20 files:
`git commit -m "ui: tracking-wider on uppercase labels"`.

### Task 3 — DESIGN.md acceptance greps, all zero

Run the full block from docs/DESIGN.md "Acceptance greps (must read 0)" verbatim.
Any non-zero line = one fix, one commit (house rule: one commit per finding).
Known current state from earlier waves: these read 0 on the desktop app as of
2026-09-11; treat regressions as bugs to bisect to the introducing commit's area,
not to blanket-fix.
Also run the icon rule beyond the named glyphs:
```
grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" src --include=*.tsx | grep -v test | grep -vE "caption|CONTENT|user content|placeholder=\"[^”]*\""
```
Triage each hit: chrome decoration → replace with lucide; user-content strings
(e.g. ad hashtag seeds, captions templates) → exempt, DESIGN.md says user content
may contain emoji. Task 1 already handled the two known chrome hits.
Verify vitest. Commit: `ui: acceptance greps green`.

### Task 4 — the audit walk + findings doc

Run `npm run dev` (vite :5173; sidecar auto-spawns). Walk, at BOTH 1280px and
375px widths (browser devtools or Playwright screenshots), these screens:
feed, grid, create, games (all 5 sub-tabs), messages (chat + notifications tabs),
gallery, store, profile, rooms, servers, settings modal (every tab), help modal,
tour dock, one duel match end. One screenshot per screen is enough evidence.

Apply the bencium 15-dimension table + reduction filter AS YOU WALK, writing
findings straight into `docs/DESIGN-AUDIT-2026-09-11.md` with this template:

```markdown
# Design audit 2026-09-11 (bencium protocol)

Method: design-audit SKILL (15 dimensions) + reduction filter, inside docs/DESIGN.md V1.

## Fixed this wave
- EmptyState emoji chrome (commit <sha>)
- uppercase tracking (commit <sha>)
- <each Task 3 finding + sha>

## Phase 1 — critical (fix next, blocks UX)
- <finding> | screen | evidence (file:line or screenshot path) | proposed fix

## Phase 2 — refinement
...

## Phase 3 — polish / backlog
- z-10..z-50 legacy values (~130 sites) -> named z vars; do when a new overlay bug appears
- transition-all x110 -> property-scoped transitions; do when one measurably repaints

## Explicit non-findings (checked, already correct)
- focus-visible, reduced-motion, 2-font cap, tabular nums, sentence-case, line-height
```

Gate: the doc exists, every Phase 1/2 finding carries a file:line or screenshot
path (bencium rule: findings are claims; the repo skill demands path:line before
planning a fix — no vibes), and the "Fixed this wave" shas match `git log`.
Commit: `git add docs/DESIGN-AUDIT-2026-09-11.md && git commit -m "docs: bencium-protocol design audit, phased findings"`.

### Task 5 — gates

```
cd I:/goongrid/apps/desktop
npm run lint                                  # 0 errors
npx tsc --noEmit -p tsconfig.json             # 0 errors
npx vitest run                                # 675 green
cd ../.. && git status --porcelain            # clean (plus the audit doc if somehow uncommitted)
```
Playwright suite: run only if it covers desktop shell views; flaky single
journey = re-run before believing (house rule).

## Tests / validation notes

- Task 1 is self-gating via tsc: changing the prop type makes every un-migrated
  caller a compile error — that IS the test, no new test file (YAGNI).
- Tasks 2-3 gate via the greps' exit counts, not assertions; vitest guards
  against breaking components whose tests query emoji text.
- Task 4's doc is the artifact; its evidence rule (path:line per finding) is the
  quality gate.

## Risks, tradeoffs, open questions

- Risk: "apply the bencium skill" could be read as "redesign the app". This plan
  says no: the skill's own break-the-rules clause covers gMatch keeping its
  deliberate retro-glass identity. Rebrand = different, much bigger PR; open
  question for the user, default: not now.
- Risk: emoji grep false-positives inside user-content templates; triage per hit,
  exemptions listed in the commit message, not silently left.
- Tradeoff: z-index and transition-all convergence skipped — measured cost (130+
  lines churn) vs zero user-visible gain today. Backlogged in Phase 3 of the doc.
- Open question (non-blocking): findings doc proposes nothing beyond polish
  scope; anything requiring a functional change gets the bencium flag sentence
  "outside design scope" and comes back to the user as a question.

## Sources

- design-audit SKILL.md: https://raw.githubusercontent.com/bencium/bencium-marketplace/main/design-audit/skills/design-audit/SKILL.md
- typography SKILL.md: https://raw.githubusercontent.com/bencium/bencium-marketplace/main/typography/skills/typography/SKILL.md
- bencium-impact-designer SKILL.md: https://raw.githubusercontent.com/bencium/bencium-marketplace/main/bencium-impact-designer/skills/bencium-impact-designer/SKILL.md
- House contract: docs/DESIGN.md; prior evidence: docs/UI-CHECKUP-2026-09-11.md
