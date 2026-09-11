# UI Checkup — V1 standardization sweep (2026-09-11)

Contract: docs/DESIGN.md. Method: measured greps (before → after), one commit
per rule family. vitest 634 stayed green across the whole sweep; no test
assertion pinned a migrated class.

| Rule | Before | After | Commit |
|---|---|---|---|
| border tokens (retro-border drift) | 207 | 0 | 2864954 |
| z-index arbitrary ≥3 digits | 42 (z-[99999]×13, z-[100000]×4…) | 0 (named --z-* scale) | e4b8cb0 |
| sub-10px text ([6/7/8/9/11]px) | 609 | 0 (6-step scale, floor 10px) | type-scale commit |
| radius 2xl/3xl/sm drift | 86 | 0 (4-step scale) | radius commit |
| emoji/glyph chrome (❤️⚡★✕✓) | 22 sites | 0 (lucide; comment-composer content kept) | 7f6b37c |
| orphan zinc literals (bg/text/border) | ~540 | 0 (gradient art stops exempt) | 5d29983 |
| scrim opacity variants on dialogs | 11 values (40→90) | 1 (bg-black/70, 58 lines) | 5d29983 |
| motion durations (75/100/200/1000) | 38 | 0 (150/300/700) | motion commit |
| non-orbit anim aliases (fade-in/slide-up/down) | 5 | 0 (orbit family) | motion commit |
| redundant copy (forge subtitle, host help) | 2 | dropped | ui copy commit |
| hover:white/10 one-offs | 7 | 0 (bg-glass-w10) | ui copy commit |

## Deliberately kept (not drift)
- Rarity badge colors / HP fill / +g$ float / GAME_AD gradients / phone-bezel
  and skeuo gradients: game semantics + game art (DESIGN.md exemptions).
- `bg-black` solid on media/player letterboxing: not a scrim.
- `text-white` over media/overlay surfaces (162 runs): intentional media-overlay
glyph color, not chrome drift — chrome text uses text-retro-*.
- ❤️/⚡ inside CommentsModal BUTTON ACTIONS: they append text to the user's own
  comment (content, not chrome) — icon+label already lucide.
- Admin kit (Badge/FilterBar primitives): token-scoped greps read 0; internal
  tool, full restyle is YAGNI.

## Skipped, add when
- Motion *token vars* (--ease-*) — Tailwind duration/ease utilities already
  cover the 3-step contract; revisit only if custom easings appear.
- Playwright journey run: UI-only wave, vitest+tsc+lint gates held; run before
  the V1 exe build.
