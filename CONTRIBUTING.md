# Contributing

Small, independently reviewable changes. The repository is the product's audit
trail, so a change is only done when its tests and its documentation land with
it.

## Workflow

1. Branch from `main`; keep one concern per branch.
2. Write the failing test first, next to the code it covers.
3. Run the full gate before opening a pull request:

   ```bash
   npm run lint        # 0 errors (warnings are allowed)
   npm run typecheck
   npm run test
   npm run build
   ```

4. Update the document that owns the behavior in the same commit
   (`docs/ARCHITECTURE-P2P.md`, `docs/SPEC.md`, `docs/SECURITY.md`, ...).
5. Describe what you verified — and what you could not verify — in the pull
   request. Do not claim network, performance or security evidence that was
   not actually executed.

## Conventions

- Desktop renderer: Vite + React 19 + Tailwind 4, imports via `@/`.
- Electron main/preload: CommonJS `.cjs`; they are covered by their standalone
  node tests (`node electron/<name>.test.cjs`), not by vitest.
- No new runtime dependency without a stated reason and a size/performance
  argument in the pull request.
- No fabricated data, fake fallbacks, or silent failure paths. When something
  cannot be done, say so in the UI and in the docs.

## Security-adjacent changes

Changes touching key handling, envelope formats, the swarm wire format or the
blocklist require a test that demonstrates the rejection path, not only the
happy path. Keep `shared/blocklist.json`, `apps/desktop/src/game/tagFilter.ts`
and `apps/desktop/electron/main.cjs` in sync — the parity test guards it.
