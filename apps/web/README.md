# ProRez web dashboard

Next.js (App Router, Cache Components) dashboard for discovering Canadian software engineering
internships, co-ops, and new grad roles, and managing applications.

> **Status (Milestone 2A):** PostgreSQL persistence layer in place (read-only from the UI). All data
> shown is fictional demo data. Nothing is sent, generated, or submitted.

## Scripts

```bash
npm run dev     # development server on http://localhost:3000
npm run build   # production build
npm run lint    # ESLint
npm test        # Vitest unit tests for pure logic in lib/
npm run test:e2e  # Playwright (desktop + mobile); builds and serves the app on port 3210
```

First-time e2e setup: `npx playwright install chromium`.

## Database (Milestone 2A)

PostgreSQL 17 + Prisma 7, run locally with Docker Compose. Pages read from fixtures by default; set
`PROREZ_DATA_SOURCE=database` to read from Postgres.

```bash
cp .env.example .env
npm run db:up && npm run db:deploy && npm run db:seed   # seed = fictional demo data, dev only
npm run test:db                                         # integration tests (separate _test database)
```

Full guide, including migrations, seeding rules, reset procedures, and the schema overview: [docs/database.md](docs/database.md).

## Structure

| Path | Purpose |
| --- | --- |
| `app/` | Routes: `/`, `/jobs`, `/jobs/[jobId]`, `/jobs/new`, `/applications`, `/resumes`, `/cover-letters`, `/projects`, `/profiles`, `/profiles/new`, `/profiles/[profileId]`, `/settings` |
| `components/ui/` | shadcn/ui-style primitives (Radix + Tailwind). `components.json` is set up for the shadcn CLI. |
| `components/<feature>/` | Feature components (jobs, applications, documents, profiles, settings, layout) |
| `lib/types.ts` | Domain models. Discovery, preparation, and submission statuses are separate fields. |
| `lib/fixtures/` | Fictional demo data (`isDemo: true`, `.example` URLs only) |
| `lib/data.ts` | Data boundary for pages; delegates to `lib/repositories/` (fixtures or PostgreSQL) |
| `prisma/` | Schema, migrations, and the dev-only demo seed |
| `lib/db/` | Prisma client, demo seed, and seed safety guard |
| `tests/db/` | Database integration tests (`npm run test:db`) |
| `lib/jobs/filters.ts` | Pure search/filter/sort logic with URL (de)serialization |
| `lib/jobs/manual-submission.ts` | Manual job form validation |
| `lib/profiles/draft.ts` | Search profile form helpers and validation |

## Conventions

- Controls that need backend support use `<FutureAction>` (visibly disabled, labelled "Soon").
- Job filter state lives in URL search params, so the explorer sits inside `<Suspense>`.
- Dates are formatted with a fixed locale/time zone (`en-CA`, `America/Toronto`) to avoid hydration mismatches.
- The theme (light / dark / system) is applied by an inline `<head>` script before first paint.
