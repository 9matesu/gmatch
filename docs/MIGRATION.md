# Migration 1.5.3 → 1.5.5

## 1. Data compatibility

No migration required. 1.5.5 recovery ships the verified 1.5.3 code and schema
unchanged: `orbit.sqlite`, `blobs/`, IndexedDB (`orbit-gallery`, `orbit-dm`),
`secure-kv.bin`, `server-mode.json`, `blocklist.json`, and `gmatch.save.v1`
(`SAVE_VERSION` 3) all carry over untouched.

## 2. What changed

- Version identifiers: `gmatch` / `@gmatch/desktop` / `@orbit/api` → `1.5.5`.
- New docs: `docs/RECONSTRUCTION.md` (+ `docs/reconstruction/` raw inventory),
  `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/P2P.md`, `docs/SECURITY.md`,
  this file, `CHANGELOG.md`.
- No behavior, dependency, protocol, or wire-format change.
- Deliberately NOT bumped: `site/release.json` and `site/index.html` still
  describe the built `gMatch-1.5.3-portable.exe` artifact (version + sha256).
  They move only when a 1.5.5 artifact is built and hashed; bumping them without
  an artifact would be fabrication.

## 3. Forward path (queued, not in 1.5.5)

Ports from `docs/RECONSTRUCTION.md` land newest-first with tests on this line;
each port states its own migration (tombstone tables 058–062, `TorrentInfo`,
IDB thread migration are the known ones). Framework move follows
ADR-1.5.5-02/05 ordering; no flag day.
