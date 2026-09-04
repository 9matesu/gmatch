# Database migrations

The canonical schema lives in `../schema.sql` and is applied idempotently on
boot by `src/migrate.ts`. It is the single source of truth for the current
schema — all tables, columns and indexes.

Versioned migrations live here as `NNN_description.sql`. They are applied in
numeric order by `src/migrate.ts` after the base schema, and only when the
recorded `PRAGMA user_version` is lower than `NNN`.

## Rules

1. `schema.sql` must always reflect the schema AFTER all migrations, i.e. the
   base file is kept up to date as you add migrations.
2. Migrations must only contain statements that are safe to run once (plain
   `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, etc.). New tables/columns go
   into BOTH `schema.sql` (for fresh databases) and a numbered migration (for
   existing databases).
3. Never edit an applied migration — add a new one with a higher number.
4. On a fresh database no migration ever runs (base schema is already current),
   so bump `user_version` to match a migration you fold into `schema.sql` only
   if you care about local copies.

This directory previously held `001_initial.sql` … `008_user_reports.sql`
which were never executed (they targeted Cloudflare D1 via `wrangler d1` while
the app runs on libsql). Their content is fully reflected in `../schema.sql`.
