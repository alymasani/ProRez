# ProRez web dashboard

Next.js (App Router, Cache Components) dashboard for discovering Canadian software engineering
internships, co-ops, and new grad roles, and managing applications.

> **Milestone 1 status:** frontend only. All data is fictional demo fixtures. Nothing is
> persisted, sent, generated, or submitted.

## Scripts

```bash
npm run dev     # development server on http://localhost:3000
npm run build   # production build
npm run lint    # ESLint
npm test        # Vitest unit tests for pure logic in lib/
npm run test:e2e  # Playwright (desktop + mobile); builds and serves the app on port 3210
```

First-time e2e setup: `npx playwright install chromium`.

## Structure

| Path | Purpose |
| --- | --- |
| `app/` | Routes: `/`, `/jobs`, `/jobs/[jobId]`, `/jobs/new`, `/applications`, `/resumes`, `/cover-letters`, `/projects`, `/profiles`, `/profiles/new`, `/profiles/[profileId]`, `/settings` |
| `components/ui/` | shadcn/ui-style primitives (Radix + Tailwind). `components.json` is set up for the shadcn CLI. |
| `components/<feature>/` | Feature components (jobs, applications, documents, profiles, settings, layout) |
| `lib/types.ts` | Domain models. Discovery, preparation, and submission statuses are separate fields. |
| `lib/fixtures/` | Fictional demo data (`isDemo: true`, `.example` URLs only) |
| `lib/data.ts` | Read-only data access — the single seam to replace with real persistence |
| `lib/jobs/filters.ts` | Pure search/filter/sort logic with URL (de)serialization |
| `lib/jobs/manual-submission.ts` | Manual job form validation |
| `lib/profiles/draft.ts` | Search profile form helpers and validation |

## Conventions

- Controls that need backend support use `<FutureAction>` (visibly disabled, labelled "Soon").
- Job filter state lives in URL search params, so the explorer sits inside `<Suspense>`.
- Dates are formatted with a fixed locale/time zone (`en-CA`, `America/Toronto`) to avoid hydration mismatches.
- The theme (light / dark / system) is applied by an inline `<head>` script before first paint.
