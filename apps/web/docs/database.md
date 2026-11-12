# Database guide

ProRez stores data in PostgreSQL 17 through Prisma 7. The web app can also run entirely on built-in fictional fixtures. That's the default, and it's what the e2e tests use.

All commands run from `apps/web` unless noted.

## Prerequisites

- Docker Desktop (macOS or Windows), running.
- Node.js and `npm install` already done. `postinstall` runs `prisma generate`, which writes the client to `lib/generated/prisma` (git-ignored).

> **macOS:** if `docker` is "not found", add Docker Desktop's CLI to your PATH. Use Docker Desktop → Settings → Advanced → "System", or add
> `export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"` to `~/.zshrc`.

## First-time setup

```bash
cp .env.example .env     # local-only credentials; never commit .env
npm run db:up            # start PostgreSQL on 127.0.0.1:5433 and wait until healthy
npm run db:deploy        # apply all migrations to prorez_dev
npm run db:seed          # optional: load FICTIONAL demo data (development only)
```

To have pages read from the database, set this in `.env` and restart `npm run dev`:

```
PROREZ_DATA_SOURCE=database
```

`fixtures` (the default) ignores the database completely.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run db:up` / `db:down` | Start / stop the Postgres container. Data persists in a Docker volume. |
| `npm run db:status` | Show which migrations are applied. |
| `npm run db:deploy` | Apply pending committed migrations. This is the only migration command used outside development. |
| `npm run db:migrate` | **Development:** create a new migration from `prisma/schema.prisma` changes and apply it. |
| `npm run db:seed` | Load or refresh the fictional demo data. Idempotent. |
| `npm run db:studio` | Browse data in Prisma Studio. |
| `npm run db:generate` | Regenerate the Prisma client after schema changes. |

## Resetting

| Goal | Command |
| --- | --- |
| Remove only demo data | Re-running `npm run db:seed` refreshes it. To delete it, call `deleteDemoData` (see `lib/db/seed-demo.ts`). |
| Drop and recreate the dev schema | `npm run db:reset`, then `npm run db:seed` if you want demo data. Prisma 7 no longer seeds automatically after a reset. |
| Delete **all** local data, including the test database | From the repo root: `docker compose down -v`, then `npm run db:up && npm run db:deploy`. |

`db:reset` asks for confirmation and destroys all data in the database named by `DATABASE_URL`. Only use it on your local dev database.

## Migrations

- Migrations live in `prisma/migrations/` and are committed.
- Workflow: edit `schema.prisma` → `npm run db:migrate -- --name describe_change` → review the generated SQL → commit both files.
- Some rules can't be written in Prisma's schema language, so they're appended as hand-written SQL to the migration (see the end of `20261112000000_init/migration.sql`):
  - CHECK constraints: score ranges, submission consistency, run timing, approval state, and "published requires URL".
  - The partial unique index `approval_requests_one_pending_per_job`.

  Prisma ignores these when it diffs, so it won't drop them. If you rename the related columns, update these by hand.
- `npm run test:db` checks that the migrated database exactly matches `schema.prisma` (no drift), and that the hand-written constraints exist.

## Demo data safety

`npm run db:seed` loads fictional fixtures, each flagged `is_demo = true`. It refuses to run when:

- `NODE_ENV=production`;
- the host isn't local (`localhost`, `127.0.0.1`, `::1`, `postgres`, `host.docker.internal`), unless `PROREZ_ALLOW_REMOTE_DEMO_SEED=1` is set for a non-production database;
- the database name contains `prod`, even with the override.

Production deployments run `prisma migrate deploy` only and never the seed. The rules are in `lib/db/seed-guard.ts` and unit-tested in `seed-guard.test.ts`.

## Tests

| Command | Database | Notes |
| --- | --- | --- |
| `npm test` | none | Pure logic, fixtures only. |
| `npm run test:e2e` | none | Playwright, pinned to `PROREZ_DATA_SOURCE=fixtures`. |
| `npm run test:db` | `TEST_DATABASE_URL` | Integration tests. The database name **must end in `_test`**. Its `public` schema is dropped and re-migrated on every run. |
| `npm run test:e2e:db` | `DATABASE_URL` | The same Playwright suite with pages reading from Postgres. Run `db:deploy` and `db:seed` first, because the expectations match the demo data. |

The `prorez_test` database is created automatically the first time the Docker volume is initialised (`infra/postgres/init/`). If your volume predates that script, create it once:

```bash
docker compose exec postgres createdb -U prorez prorez_test   # from the repo root
```

## How the app reads data

```
page.tsx ──► lib/data.ts ──► PROREZ_DATA_SOURCE
                              ├─ fixtures → lib/repositories/fixture-repository.ts
                              └─ database → connection() → lib/repositories/prisma-repository.ts → PostgreSQL
```

- Pages import only from `lib/data.ts`. Both repositories implement `DataRepository` (`lib/repositories/repository.ts`).
- In database mode, `connection()` defers reads to request time. Builds never contact the database, and data is never baked into prerendered HTML.
- `tests/db/repository.db.test.ts` checks that, after seeding, the database repository returns exactly what the fixture repository returns.
- There are no write endpoints yet, so nothing in the app can modify the database.

## Schema overview

| Area | Tables |
| --- | --- |
| Sources & canonical jobs | `job_sources`, `job_postings` (canonical, unique `dedupe_key`), `job_locations`, `source_observations` (one per sighting; unique `(source_id, external_id)`), `job_matches` |
| Search profiles | `search_profiles`, `profile_criteria` (1:1), `job_profile_evaluations` (one per job, which makes notifications deduplicated), `job_profile_matches` (ranked; rank 0 = primary) |
| Applications | `applications` (one per job), `application_events` (append-only history), `workflow_runs` |
| Artifacts | `resume_artifacts`, `cover_letter_artifacts` (metadata only; `storage_key` reserved for files) |
| Projects | `projects`, `project_jobs` (many-to-many) |
| Approvals | `approval_requests` (at most one pending per job; Telegram ids reserved) |

## Troubleshooting

- **Port 5433 in use:** set `PROREZ_DB_PORT` in a `.env` file at the repo root (read by Docker Compose). Update the port in `apps/web/.env` to match.
- **`Cannot connect to the test database`:** run `npm run db:up` and check that `TEST_DATABASE_URL` is set in `.env`.
- **Types out of date after pulling:** `npm run db:generate`.
