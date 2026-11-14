# ATS board synchronization (Milestones 3A–3C)

Boards in the employer-board registry (`/boards`) can be synchronized **manually** with **Sync now**. Nothing runs on a schedule.

## Providers and endpoints

All four are official, public, unauthenticated read APIs. They were checked against vendor documentation on 2026-11-11.

| Provider | Endpoint | Pagination | Publication time | Docs |
| --- | --- | --- | --- | --- |
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | none | list has `updated_at` only → stored as *updated*, no latency | developers.greenhouse.io/job-board.html |
| Lever | `GET api.lever.co/v0/postings/{site}?mode=json&skip=&limit=100` | skip/limit (max 20 pages) | none documented → none | github.com/lever/postings-api |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=false` | none | `publishedAt` = *last* published → stored, no latency | developers.ashbyhq.com/docs/public-job-posting-api |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=` and `/postings/{id}` for details | offset/limit (max 10 pages; details for Canadian postings only, max 150) | `releasedDate` → *first published*; latency shown | developers.smartrecruiters.com/docs/posting-api |

Code: `lib/ats/providers/*`, shared contract `lib/ats/types.ts`.

## Network safety (`lib/ats/http.ts`)

- Requests go only to the four API hosts above, over https, with no credentials or custom ports. URLs are built from constants plus the stored, validated board token. URLs found in descriptions or submitted by users are **never** requested.
- Redirects are refused. Each request has a 20 s timeout, and the whole sync has 120 s. Responses are capped at 15 MB and must be JSON. Cancellation is supported.
- Sync uses the same local-only Server Action guard as every other write.

## Normalization (`lib/ats/normalize.ts`, `canada.ts`, `classify.ts`)

- **Canada:** a posting is imported only when there is evidence:
  - a structured country of Canada;
  - a province or territory (name, or a code after a comma);
  - an unambiguous Canadian city;
  - remote text naming Canada.

  "Remote", "Worldwide", "North America" and ambiguous cities alone (London, Victoria) are skipped. "NL", "SK" and "PE" need corroboration because they are also country codes. "Remote – Canada" is stored with no province, meaning open in every province.
- **Employment type:** taken from the title (co-op / intern / new grad / junior), plus Ashby's `Intern`. Senior and other roles are skipped with a reason. Profiles decide priority; no duration is hard-coded.
- **Duration:** a single stated length ("4-month", "eight months"). Ambiguous text ("4 or 8 months") stays unknown, so matching marks it *needs review*.
- **Work arrangement:** from the provider or text. If none is stated, on-site is assumed and the job's history says so.
- **Description:** HTML is converted to plain text. HTML is never rendered.
- **Company:** the employer name from the registry.

## Ingestion (`lib/ats/sync.ts`)

- **One sync per board:** a partial unique index on `board_sync_runs` blocks concurrent syncs. Runs stuck for more than 15 minutes are marked failed so a retry can start.
- **Identity:** a posting is identified by `(provider, board token, posting id)` on `source_observations`. This is the same identity manual URL submission records, so a job you saved by hand is matched, not duplicated.
  - If there is no identity match, an existing job with the same canonical URL, or the same company + title + location, gets another sighting.
  - Otherwise a new automatic job is created.
- **Updates:**
  - Unchanged postings (same content hash) only refresh last-seen.
  - Changed postings update provider-derived fields of *automatic* jobs only, and append a description snapshot.
  - Notes, discovery status, salary, applications and manually added jobs are never overwritten.
- **Classification:** every fetched posting is NEW, UPDATED, UNCHANGED or REACTIVATED (a previously inactive posting listed again: counter reset, job reopened, same identity).
- **Completeness:** each adapter reports `complete` and an `incompleteReason`. A snapshot is complete only when every page was read, no item was dropped for lacking an id, and provider counts agree (Greenhouse `meta.total`, SmartRecruiters `totalFound`). Lever and SmartRecruiters page caps make a snapshot incomplete. A 200 response alone is not proof.
- **Missing and inactive (Milestone 3B):** only after a *complete* snapshot whose postings were all saved:
  - each active posting that was not listed gets `missing_count + 1` (counted as MISSING);
  - at **2 consecutive** absences it becomes inactive (`closed_at` = inactivation time);
  - an automatic job with no active sightings, in status discovered or saved, becomes expired. Jobs you dismissed are left alone;
  - a posting that reappears has its counter reset (and is reactivated if it was inactive).
  - Failed, partial (incomplete or truncated) and skipped runs never count absences or expire anything. Nothing is ever deleted.
- **Matching:** new, changed and expired jobs are re-evaluated against enabled profiles, with profile versions recorded.
- **Run status:** `succeeded` (complete), `partial` (imported, but the catalogue was incomplete or some postings failed to save — nothing expired), `failed`, or `skipped` (a scheduled run found another sync of the board running). Each run records its trigger (`manual` or `scheduled`).
- **Failures:** a failed sync is recorded with an error code. Already-imported data is kept, the board's failure count increases, and the next successful sync resets it.
- **Metrics:** each run records counts, duration, errors and skip reasons. Each sighting records first detected, last seen, provider publication time and its meaning, and closed time.

## Run accounting (Milestone 3C)

Every fetched posting gets exactly one **primary disposition**, so these always sum to `fetched` (this is tested):

| Field | Meaning |
|---|---|
| `created` (new) | A new canonical job. |
| `updated` | A known posting whose content changed. |
| `unchanged` | A known posting with the same content. |
| `reactivated` | A previously inactive posting that is listed again. |
| `duplicate` | Eligible, but recorded as another sighting of a job already known from another source or URL. |
| `filteredLocation` | Not a Canadian location: outside Canada, remote without Canada eligibility, or "Canada" with no province for a non-remote role. |
| `filteredEmploymentType` | Not an internship, co-op, new-grad or junior role (senior, leadership or other roles). |
| `ingestErrors` | Eligible, but could not be saved. |

Derived and secondary diagnostics (these overlap the above):

| Field | Meaning |
|---|---|
| `eligible` | `fetched − filteredLocation − filteredEmploymentType`. |
| `skipped` | `filteredLocation + filteredEmploymentType`; kept for older runs. |
| `invalid` | Provider items dropped as unreadable (no id or title). Not part of `fetched`; such items also make the snapshot incomplete. |
| `enrichmentIncomplete` | Eligible postings with a missing or very short description. |
| `missing` / `closed` | Absence tracking (`closed` = newly inactivated). |

Filters are about what you see, not about whether a posting still exists. A posting that becomes filtered, for example retitled as a senior role, is still *listed*, so it is never counted missing or expired.

**Why so many postings are "skipped".** Live boards mostly list roles outside ProRez's scope. In November 2026:
- *Cohere* (121 postings): 2 eligible, 72 not entry-level, 43 outside Canada, 4 "Canada" without a province.
- *StackAdapt* (67 postings): 0 eligible, 28 outside Canada, 33 "Canada"/"Canada; United States" without a province or workplace type, 6 not entry-level.

None of the "Canada without a province" postings were entry-level, but see the limitation in the 3C report.

## Description enrichment (SmartRecruiters)

SmartRecruiters lists postings without descriptions, so each Canadian posting needs one detail request. This is capped at **150 per sync**, which keeps the request rate within the documented limit:
- Postings with no stored description are enriched first, then refreshes, so capped runs resume where the last one stopped.
- A posting whose description was deferred keeps its stored description. Its content hash is computed *with* that description, so nothing is blanked and nothing flips between "changed" and "unchanged".
- Deferrals are reported as a run warning, not as errors. New postings without a description count as `enrichmentIncomplete` until enriched.
- Enrichment never affects listing completeness: missing-posting detection depends only on the listing.

## Lever EU

Lever boards hosted in the EU (`jobs.eu.lever.co`) are read from `api.eu.lever.co`. The region is taken from the board URL ("Fill from URL" and discovery), never from your location. It is stored as `employer_boards.region = 'eu'`. Board token uniqueness is per provider, so a US and an EU board with the same token cannot both be registered.

Greenhouse's `job-boards.eu.greenhouse.io` URLs are recognised but read from the default Greenhouse API; a board that is EU-only fails verification there.

## Automatic synchronization (Milestone 3B)

A separate worker process syncs enabled boards on a schedule. It never runs inside the web server or an HTTP request.

```
npm run worker            # run continuously (Ctrl+C or SIGTERM stops it gracefully)
npm run worker -- --once  # sync every board that is due now, then exit (cron-friendly)
```

Start it next to the web app with the same `.env`. It needs `PROREZ_DATA_SOURCE=database` and PostgreSQL. Running several copies is safe.

**Development:** `npm run dev:all` starts `next dev` and the worker as two child processes, with output prefixed `[web]` and `[worker]`. Ctrl+C stops both, including all their descendants. If either exits, the other is stopped too, so no worker is left behind. The worker is never started inside Next.js, so hot reload cannot create a second one. `npm run dev`, `npm run worker` and `npm run worker -- --once` are unchanged.

**Production:** run the worker as its own supervised service with restart-on-failure, next to `npm start`. ProRez does not ship deployment files; use your platform's supervisor. For example, with systemd:

```ini
# /etc/systemd/system/prorez-worker.service
[Service]
WorkingDirectory=/srv/prorez/apps/web
ExecStart=/usr/bin/npm run worker
Restart=on-failure
RestartSec=10
KillSignal=SIGTERM
TimeoutStopSec=45
```

Equivalents: a macOS LaunchAgent with `KeepAlive`, Windows Task Scheduler or a service wrapper running `npm run worker`, or a container with `restart: unless-stopped`. The worker stops cleanly on SIGTERM (it waits up to 30 s for running syncs). If it is killed outright, leases expire, so a restart never loses or duplicates work.

**Scheduling state lives in PostgreSQL** (`employer_boards`), so restarts lose nothing:

| Column | Meaning |
|---|---|
| `next_sync_at` | When the board is next due. Null = not scheduled: disabled, demo, or paused after a configuration error. |
| `sync_lease_owner`, `sync_lease_expires_at` | Which worker holds the board and until when. |
| `last_checked_at`, `last_success_at`, `consecutive_failures`, `last_error_code`, `last_error_message` | Attempt and failure history. |

- **Interval:** each board's own check interval (`poll_interval_minutes`, chosen when registering; default **6 hours**), with ±10% jitter.
- **Scheduling:** registering or enabling a real board schedules it immediately; disabling unschedules it. Demo boards are never scheduled.
- **Claiming:** a single atomic `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` claims a due board and sets a lease, so two workers can never claim the same board. A worker only runs a board while it still holds the lease (duplicate delivery is ignored) and renews the lease while syncing.
- **Crash recovery:** if a worker dies, its lease expires (default 10 minutes) and any worker reclaims the board; a run left `running` is closed as failed (`stale`) after 15 minutes.
- **Manual Sync now** still works and shares the per-board lock. A scheduled run that finds a manual sync running is recorded as `skipped` and retried in about 5 minutes. A manual sync also resets the schedule.
- **Concurrency:** at most `PROREZ_WORKER_CONCURRENCY` boards at once (default 3) and `PROREZ_WORKER_PROVIDER_CONCURRENCY` per provider (default 1). One slow or failing board never blocks the others.
- **Retries (two levels):**
  - *Per request* (`withRetries` in `lib/ats/http.ts`): 429, 5xx, timeouts and network errors are retried up to `PROREZ_SYNC_MAX_RETRIES` times (default 3) with exponential backoff and jitter. `Retry-After` is honoured when it is 30 seconds or less; longer values end the run.
  - *Per run* (`lib/ats/schedule.ts`): a failed run is retried after 5, 10 and then 20 minutes (`PROREZ_SYNC_RETRY_BASE_MINUTES`, doubling), never sooner than a provider's `Retry-After`. After that the board returns to its normal interval.
- **Permanent errors** (unknown board, blocked host) pause the board (`next_sync_at = null`, shown as "Paused — needs attention"). Fix the board, then disable and re-enable it, or use Sync now, to resume.
- **Database outages:** a worker that cannot record a run releases its lease with a 5-minute backoff and keeps going. The database client has connection and idle timeouts plus TCP keep-alive, so dead connections fail fast instead of hanging.

| Variable | Default | Meaning |
|---|---|---|
| `PROREZ_WORKER_CONCURRENCY` | 3 | Boards synced at the same time |
| `PROREZ_WORKER_PROVIDER_CONCURRENCY` | 1 | Boards per provider at the same time |
| `PROREZ_WORKER_POLL_SECONDS` | 30 | How often the worker looks for due boards |
| `PROREZ_WORKER_LEASE_MINUTES` | 10 | Lease length (crash-recovery delay) |
| `PROREZ_SYNC_MAX_RETRIES` | 3 | Per-request retries, and per-run backoff attempts |
| `PROREZ_SYNC_RETRY_BASE_MINUTES` | 5 | First per-run retry delay (doubles) |

Invalid values stop the worker at start-up with a clear message.

**Log format** (one line per event):

```
2026-11-12T20:54:13.899Z [worker] sync_started board=65af… employer=StackAdapt provider=greenhouse
2026-11-12T20:54:14.308Z [worker] sync_finished board=65af… employer=StackAdapt status=succeeded complete=true fetched=67 new=0 updated=0 unchanged=0 reactivated=0 missing=0 inactivated=0 skipped=67 errors=0 ms=400 next=2026-11-13T02:45:31.779Z
```

Other events: `worker_started`, `sync_failed`, `sync_not_run`, `sync_crashed`, `claim_stale`, `lease_lost`, `tick_failed` and `worker_stopped`.

## Tests

- `lib/ats/**/*.test.ts`: adapters (synthetic responses, pagination, malformed items, errors), Canada, classification, HTML, transport safety, latency.
- `tests/db/ats-sync.db.test.ts`: ingestion, idempotency, updates, preserving user data, sightings, close/reopen, failure and recovery, concurrency.
- `tests/db/scheduler.db.test.ts`: scheduling, atomic claims under concurrency, restarts, lease expiry and crash recovery, duplicate delivery, the worker loop and its concurrency limits, failures (429/Retry-After, 500, timeout, configuration errors, database errors), and reconciliation (new, updated, unchanged, reactivated, the two-snapshot rule, failed and partial runs, empty boards, idempotency).
- `tests/db/provider-pipeline.db.test.ts`: all four real adapters with paginated recorded-shape responses, run by the worker into PostgreSQL with Canadian filtering and matching.
- `lib/ats/schedule.test.ts`, `lib/ats/providers/completeness.test.ts`, `lib/ats/http.test.ts`: scheduling policy, completeness and truncation, retries and Retry-After.
- `e2e/board-sync.spec.ts`: database-mode UI using recorded responses in `e2e/fixtures/ats`. These are enabled by `PROREZ_ATS_TRANSPORT=fixtures`, which is only allowed against `*_e2e` or `*_test` databases.
- Optional live smoke test (off by default):
  ```
  PROREZ_ATS_SMOKE="greenhouse:<token>,lever:<site>" npm run test:smoke
  ```

## Workday and company career sites (Milestone 3D)

Workday career sites and generic company careers pages are synced by the same worker, with the same accounting, leases, retries and reconciliation. Their listing completeness is stricter: Workday totals of 2,000 or more and generic snapshots that are not provably exhaustive never mark postings missing. Description enrichment is tracked separately (`board_sync_runs.description_complete`). Details: [career-sources.md](career-sources.md).
