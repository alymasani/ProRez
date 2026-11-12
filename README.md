# ProRez

**ProRez** is a self-hosted, AI-assisted job discovery, application preparation, resume editing, and career management platform focused initially on Canadian software engineering opportunities.

ProRez is designed to find relevant jobs early, match them against configurable search profiles, ask for approval through Telegram or the website, and prepare tailored resumes, cover letters, and—when explicitly requested—substantial software portfolio projects. Its planned **Resume Studio** will provide visual editing, explainable job-description alignment analysis, and PDF, Word, and LaTeX exports.

> **Project status: Early development.** The responsive web dashboard, PostgreSQL foundation, persistent search profiles, deterministic matching engine, and employer-board registry have been implemented. Live job scraping, Telegram notifications, AI generation, Resume Studio, and application autofill are planned—not yet available. The implementation status below is based on the most recent development/QA report.

## Current Capabilities

### Web Dashboard — Implemented (Milestone 1)

- Responsive Next.js dashboard with desktop sidebar and mobile navigation.
- Light, dark, and system themes.
- Overview, jobs, job details, manual-submission preview, applications, resumes, cover letters, projects, search profiles, employer boards, and settings pages.
- Job search, filtering, and sorting using URL-backed query state.
- Application table and board views, document-library previews, and project-status views.
- Accessible form controls, validation, empty states, and error states.
- Explicit demo indicators for fictional fixtures; unsupported backend actions are not presented as working.

### PostgreSQL Data Foundation — Implemented (Milestone 2A)

- PostgreSQL 17 development and test databases managed with Docker Compose.
- Prisma schema, versioned migrations, relational constraints, indexes, and integration tests.
- Database-backed reads behind the existing data-access layer.
- Fixture mode for isolated frontend tests; database mode for persisted data.
- Repeatable development seeding with safeguards against production use.
- Distinct database environments for development, integration tests, and browser tests.

### Persistent Profiles, Matching, and Board Registry — Implemented (Milestone 2B)

- Create, edit, duplicate, enable/disable, and delete search profiles in database mode.
- Multiple active profiles, optimistic concurrency checks, field validation, and unsaved-change warnings.
- Profile version history and archival protection for referenced historical records.
- Hard-rule eligibility matching for employment type, duration, Canadian location, keywords, discipline, and experience requirements.
- Explicit **needs review** outcomes when information is missing or ambiguous.
- Preferred-keyword relevance scoring, separate from hard eligibility and future candidate-fit analysis.
- One canonical result per job with all applicable profiles and a primary match.
- Registry of multiple employer boards for supported ATS providers, including identifiers, enabled status, polling configurations, and health fields.
- Database-backed provider registration and uniqueness constraints.

**Current limitations:** No ATS polling or Telegram delivery is active. Candidate-fit scores are still sample data. The existing “4 months” duration rule permits terms of up to four months, including three-month placements; strict four-month matching is planned. Search-profile changes currently trigger a full matching pass. Settings are not yet persisted, and local-only mutation protection is **not** production authentication.

## Planned Product Features

### 1. Automated Job Discovery

- Monitor newly published Canadian positions from employer career sites and supported applicant tracking systems.
- **Initial free provider adapters:** Greenhouse, Lever, Ashby, SmartRecruiters.
- Support multiple employer boards per provider, each with its own polling interval and health history.
- Add permitted employer-specific Workday integrations where technically and contractually appropriate.
- Normalize posting details, track first-seen timestamps, and merge duplicate observations into canonical job records.
- Poll at source-appropriate intervals, honor access restrictions and rate limits, and measure discovery latency.
- Optionally add paid data sources such as TheirStack, JSearch, and Adzuna after benchmarking free coverage.
- Browse software engineering, embedded, infrastructure, backend, frontend, full-stack, junior, internship, co-op, and new-graduate jobs.

### 2. Configurable Job Search Profiles

- Presets for **four-month software engineering co-ops**, **junior software developer positions**, and **new-graduate software engineer roles**.
- User-defined profiles with titles, keywords, disciplines, seniority, employment types, duration ranges, provinces, and remote/hybrid/on-site preferences.
- Strict-duration and flexible-duration options, with ambiguous listings directed to review.
- Profile-specific minimum candidate-fit thresholds, notification preferences, and automation modes.
- Multiple simultaneous profiles; one job may match several profiles but should normally trigger one combined notification.
- Persisted profile versions so historical evaluations remain understandable after settings change.

### 3. Job Matching and Gap Analysis

- Deterministic eligibility checks first, followed by optional GPT-supported analysis of verified experience against a saved job description.
- Distinguish hard disqualifications, uncertain eligibility, keyword relevance, and candidate-specific fit.
- Identify documented skills, responsibilities, experience gaps, and missing evidence without fabricating qualifications.
- Provide interpretable explanations for matches and non-matches.
- Re-evaluate affected jobs on arrival or profile change using a durable background queue.

### 4. Telegram Notifications and Shared Approval Workflow

- Notify users of new jobs matching enabled profiles, including company, role, location, duration, source, link, matching profiles, and candidate-fit assessment.
- Support **Full Build**, **Quick Apply**, and **Skip** actions.
- Use the **same actions on the website**; Telegram is not required to initiate work.
- Synchronize approvals and project selections across the website and Telegram.
- Prevent duplicate notifications, duplicate approvals, and repeated background tasks.
- Send progress, errors, completion notices, and links to generated application materials.
- Add Discord as an optional later notification channel.

### 5. Manual Job Submission

- Add a job via URL, pasted job-description text, and optionally uploaded description files.
- Extract and confirm the employer, role, location, employment type, duration, and job requirements.
- Run manually submitted jobs through the same matching, approval, generation, and history workflows as discovered jobs.
- Start Quick Apply or Full Build from the job detail page.

### 6. AI Resume and Cover Letter Generation

- Reuse the existing `job-apps` Claude Code workflow to tailor documents to a particular job.
- Use a verified master career profile, existing projects, and a saved snapshot of the job description.
- Generate job-specific resumes and cover letters with evidence-based claims.
- Preserve application versions and associate each generated artifact with its job and workflow run.
- Keep application preparation distinct from actual submission; require user review before applying.

### 7. Deliberate AI Portfolio Project Generation

**Full Build is opt-in.** No project is generated merely because a job was discovered.

1. The user selects **Full Build** in Telegram or on the website.
2. A cost-efficient **GPT** model compares the job requirements with verified past experience, existing projects, and resume skill gaps.
3. GPT proposes **exactly three distinct, technically substantial project ideas** with JD alignment, gap coverage, new technologies, architecture, scope, and testing plans.
4. The user may select an idea, regenerate proposals, reuse an existing project, or cancel—through either interface.
5. Only after project selection does **Claude Code** implement the chosen project.
6. The project is built as a credible engineering deliverable—not a throwaway demo—with appropriate architecture, functionality, documentation, error handling, tests, and CI.
7. Required checks may include unit, integration, end-to-end, load, fault-injection, security, and performance tests, depending on the project.
8. The user reviews the verified result before publishing or presenting it as completed resume experience.
9. The completed project can feed into job-specific resume and cover-letter generation.

Project selection prioritizes meaningful resume gap closure, direct JD relevance, portfolio credibility, and learning useful **new languages, tools, frameworks, or engineering practices**. Projects may extend prior experience but need not be derived from it. Projects should be reusable across related applications when appropriate. An untested or incomplete project must not be represented as completed work.

### 8. Interactive AI Resume Studio

For every generated resume, ProRez will provide an editable, job-linked workspace:

- Drag and drop entire sections, experiences, projects, skill groups, and bullet points.
- Reorder, hide, show, duplicate, and revise content without manipulating raw LaTeX or Word documents.
- Keep one structured resume document as the source of truth; templates only control presentation.
- Preview changes live, undo/redo, and maintain immutable revision history.
- Begin with five ATS-conscious single-column styles: **Jake's Resume**, **sb2nov**, **University Classic**, **Modern Minimal**, and **Technical Compact**, subject to licensing reviews where relevant.
- Switch templates without losing text, ordering, or verified career data.
- Provide supported typography, spacing, and layout controls.
- Export **searchable PDF**, **editable DOCX**, and **Overleaf-compatible `.tex`**, with render/compilation and text-extraction validation.

### 9. GPT-Powered Resume Evaluation and Claude Editing

- Use **GPT** to assess job-description alignment, requirement evidence, content quality, and improvement opportunities.
- Use deterministic PDF/DOCX extraction and document checks for machine readability, headings, reading order, and content integrity.
- Provide explainable ProRez assessment scores and an evidence-based **interview competitiveness** discussion—not a purported probability of receiving an interview or a guarantee of ATS acceptance.
- Identify specific evidence gaps and tie findings back to JD requirements and resume passages.
- Use **Claude Code** for requested resume edits through the Studio sidebar, including rewritten bullets, reordering, and supported formatting changes.
- Show structured before/after proposals and require user acceptance before applying edits.
- Re-run GPT evaluation against the saved JD after accepted revisions, compare assessment histories, and highlight improvements or regressions.
- Cache unchanged analyses; avoid GPT calls on every keystroke or drag event.
- Track model usage and support API spending controls.
- Never add invented qualifications just to raise an internal score.

### 10. Application Tracker and Artifact History

- Manage discovery, preparation, approval, and submission as distinct states.
- Track saved, skipped, preparing, ready-for-review, applied, interviewing, offer, rejected, and withdrawn opportunities.
- Associate original posting snapshots, profile versions, resumes, letters, projects, AI evaluations, and workflow logs with each application.
- Search previous applications and retrieve or reuse approved documents.
- Record actual submission explicitly; generating a resume never marks the job as applied.

### 11. GitHub Project Publication

- Create repositories under the user's authenticated GitHub account, private by default.
- Publish only reviewed projects with required validation checks and documentation.
- Use the user's configured Git identity and avoid optional Claude co-author trailers or automatic AI collaborators.
- Verify Git commit metadata and inspect publication contents before pushing.
- Track project repository URLs, build status, test results, and publication history.
- Commit authorship and visible collaboration settings do not establish that development was AI-free; follow any applicable AI-assistance disclosure requirements.

### 12. Browser Autofill Assistance

- Initially provide an application handoff to tools such as Simplify Copilot, with the correct job link and generated documents available.
- Investigate optional browser-extension-based autofill, using a verified candidate profile and user review before final submission.
- Do not assume an official programmable Simplify integration or automatically submit applications without authorization.

### 13. Self-Hosting, Installer, and Operations

- Develop and test the web application on macOS, Windows, or Linux.
- Eventually host the backend, database, job-discovery worker, notification service, and Claude worker on a dedicated PC or server.
- Provide an authenticated, HTTPS-protected dashboard accessible across approved devices.
- Add a Windows installation wizard to configure dependencies, services, secrets, connections, and automatic startup.
- Support durable queues, idempotent approvals, recovery after restarts, health monitoring, backups, and failure alerts.
- Keep the local development server and database inaccessible to the public internet.
- Use API keys and supported provider authentication for server-side integrations; do not store chat subscription credentials or expose tokens to browsers.

## Planned Technical Stack

| Layer | Technology / Approach |
|---|---|
| Frontend | Next.js App Router, TypeScript |
| UI | Tailwind CSS, shadcn/ui-style components, Lucide |
| Backend | Next.js server interfaces and separate Node.js/TypeScript workers |
| Database | PostgreSQL 17, Prisma 7 |
| Development environment | Docker Compose, macOS/Windows |
| Authentication | To be selected and implemented before network exposure; Supabase Auth is a candidate |
| Artifact storage | Local/private object storage; Supabase Storage remains an option |
| Job sources | Greenhouse, Lever, Ashby, SmartRecruiters adapters |
| Matching | Deterministic TypeScript rules plus optional model-assisted gap analysis |
| AI ideation/evaluation | OpenAI API (GPT) |
| AI generation/editing | Claude Code / supported Anthropic integration |
| Notifications | Telegram Bot API; Discord later |
| Project publishing | Git, GitHub CLI/API |
| Resume rendering | Structured resume model; template-specific PDF/DOCX/LaTeX rendering |
| Testing | Vitest, Playwright, PostgreSQL integration tests |
| Deployment | Self-hosted workers, database, secure web app; Windows installer later |

## Development Roadmap

### Completed

- [x] **Phase 1 — Web Dashboard:** Responsive pages, fixtures, profiles UI, job filtering, theme support, accessibility, unit and browser tests.
- [x] **Phase 2A — Database Foundation:** Dockerized PostgreSQL, Prisma schema and migrations, data-access boundary, safe seeds, real database tests.
- [x] **Phase 2B — Persistent Profiles and Matching:** Profile CRUD and versions, deterministic matching and explanations, employer-board registry, database-backed UI, validation and tests.

### Next

- [ ] **Phase 2C — Manual Jobs and Settings:** Save real manual submissions, persist settings, add application-submission records, and tighten duration semantics.
- [ ] **Phase 3 — Free Job Discovery:** Implement four public ATS adapters, board polling, normalization, first-seen tracking, source observations, health monitoring, and deduplication.
- [ ] **Phase 4 — Background Matching and Telegram:** Match on job arrival, queue decisions, Telegram alerts, website approvals, and duplicate suppression.
- [ ] **Phase 5 — AI Application Generation:** Connect approved jobs to Claude Code resume and cover-letter workflows, persistent artifacts, and review states.
- [ ] **Phase 6 — Project Ideation and Engineering:** GPT three-proposal workflow, synchronized project selection, Claude implementation, validation, and GitHub publication.
- [ ] **Phase 7 — Interactive Resume Studio:** Structured document editing, drag-and-drop, versioning, five templates, and PDF/DOCX/LaTeX export.
- [ ] **Phase 8 — AI Resume Verification Loop:** GPT JD/ATS-readiness analysis, Claude edits, approval diffs, GPT re-verification, and cost tracking.
- [ ] **Phase 9 — Application Autofill and Management:** Document handoff, browser assistance evaluation, and expanded application history.
- [ ] **Phase 10 — Production Security and Hosting:** Authentication, deployment hardening, background services, backups, and Windows installer wizard.
- [ ] **Phase 11 — Paid Provider Expansion:** Benchmark and optionally enable paid job-data feeds without changing matching and approval logic.

## Development Setup

### Requirements

- A supported Node.js version for the installed Next.js release
- npm
- Docker Desktop with Docker Compose
- Git

### Run locally

```bash
# Clone
 git clone https://github.com/alymasani/ProRez.git
 cd ProRez

# Start PostgreSQL using the repository's Compose configuration
 docker compose up -d

# Install dependencies and start the web application
 cd apps/web
 npm install
 npm run dev
```

Open **http://localhost:3000**.

By default, the web application may run in fixture mode. To use persisted development data, configure `apps/web/.env` as documented in [`apps/web/docs/database.md`](apps/web/docs/database.md) and set:

```dotenv
PROREZ_DATA_SOURCE=database
```

Local write operations currently require the development-only mutation setting documented in the app. **Do not enable or expose development-only mutation controls on a public network.**

Consult [`apps/web/docs/database.md`](apps/web/docs/database.md) and [`apps/web/docs/matching.md`](apps/web/docs/matching.md) for migration, seeding, matching, and troubleshooting details.

### Validation

From `apps/web`:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:db
npm run build
npm run test:e2e
npm run test:e2e:db
```

Database and browser tests require the documented local setup. Playwright may require `npx playwright install chromium` on a new development machine.

## Latest Reported QA Results

**Milestone 2B** (results reported by the Claude Code development workflow; not independently reproduced in this README):

| Check | Reported result |
|---|---|
| ESLint | Pass, no warnings |
| TypeScript | Pass |
| Unit tests | 124 passed |
| PostgreSQL integration tests | 66 passed |
| Production build | Pass |
| Fixture E2E | 108 passed, 24 intentionally skipped |
| Database E2E | 112 passed, 20 intentionally skipped |

The new migration was tested against data from Milestone 2A. The current setup remains single-user and intended for local development.

## AI Usage and Costs

ProRez separates AI responsibilities to manage cost:

- **GPT / OpenAI API:** Job-description interpretation, skill-gap analysis, three project proposals, resume alignment analysis, and re-verification after edits.
- **Claude Code / Anthropic:** Substantial project implementation, application document generation, and user-requested resume editing.
- **Local tools:** Deterministic job filtering, document extraction, tests, compilation, Git metadata checks, and rendering when practical.

**Subscriptions are not equivalent to API credits.** ChatGPT Plus does not include standard OpenAI API usage. Claude Pro includes personal Claude Code usage within subscription limits, but programmatic application integration may require separately billed Anthropic API access and supported authentication. ProRez will offer configurable model selection, caching, limits, and per-workflow cost visibility. Verify current provider policies before enabling unattended automation.

## Principles

- **Relevance over volume:** Detect meaningful opportunities and avoid duplicate alerts.
- **Quality over quantity:** Build substantial, tested, job-relevant projects rather than throwaway demos.
- **Verifiable experience:** Never invent skills, experience, metrics, or completed work.
- **Human approval:** Explicit decisions for project selection, publication, and job submission.
- **Explainability:** Make matching and resume analysis understandable; do not claim to predict actual ATS outcomes or interview probabilities.
- **Portability:** Separate web frontend, background workers, and integrations so ProRez can move between macOS development and Windows hosting.
- **Privacy and cost control:** Protect career documents and API credentials while limiting unnecessary model calls.

---

**ProRez finds the opportunity, helps build the evidence, prepares the application, and keeps you in control.**
