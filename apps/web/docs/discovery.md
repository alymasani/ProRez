# Automatic board discovery (Milestone 3C)

Discovery finds employer job boards on the four supported ATS providers (Greenhouse, Lever, Ashby and SmartRecruiters), Workday career sites and company careers pages, verifies them, and registers the trustworthy ones. Registered sources are synced by the existing worker exactly like boards you add by hand ([ats-sync.md](ats-sync.md)).

Workday and careers-page specifics (URL formats, extraction strategies, routing, completeness, rendering): [career-sources.md](career-sources.md).

## How it works

```
sources ─▶ candidates ─▶ verification ─▶ registration ─▶ 3B worker syncs the board
           (one per board)  (ATS API + company website)  (existing board model)
```

1. **Sources** produce URLs. Only URLs the recogniser (`lib/boards/board-url.ts`) identifies as a supported ATS board or posting are kept.
   - **Search** (`lib/discovery/search.ts`): Tavily Search by default, or Brave when explicitly selected.
   - **Your saved jobs** (`existing_jobs`): boards referenced by jobs you added that are not registered yet. Free, and needs no credentials.
   - **Common Crawl** (`lib/discovery/import.ts`): a bounded file you import (see below).
   - **Verified company domains** (`company_domain`, Milestone 3D): `https://{domain}/careers` for companies whose careers page has not been examined yet (10 per run, free).
   - **Careers pages** (`career_page`): boards a company careers page links or redirects to.

   Search and Common Crawl also yield Workday career sites (`site:myworkdayjobs.com` queries) and company careers pages (unrestricted careers queries; only careers-landing URLs on company domains are kept).
2. **Candidates** (`discovery_candidates`) are unique by provider + board token, so every URL variant of a board collapses into one row: board page, posting, embed or API URL.
3. **Verification** (`lib/discovery/verify.ts`):
   - An already-registered board is linked, never modified.
   - The board must answer on the provider's public API through the existing adapter. Otherwise it is rejected.
   - Company-website *hints* are taken from the board's own content (posting texts; the Greenhouse board intro).
   - **Ownership** is established only when that website links to the board, or its careers page redirects to it. The match is exact on provider, token and region.
4. **Outcome:**

   | Status | Meaning |
   |---|---|
   | `verified` | Live board with ownership evidence. Registered automatically when `PROREZ_DISCOVERY_AUTO_REGISTER=true` (the default). |
   | `pending_review` | Live board, but the company could not be confirmed. Waits for you. |
   | `rejected` | No such board, an invalid response, rejected by you, or still unreachable after 3 attempts. |
   | `registered` | A board exists, created by discovery or already registered. |
   | `discovered` / `validating` | Queued, or being checked. |
   | `unsupported` | A careers page with no reliable extraction method (diagnostics kept as evidence). |

### What never counts as ownership

These sources only *find* boards: a search result, a Common Crawl row, a job you saved, an ATS identifier, or a company name that looks similar. A board registered automatically always has an `official_site_link` or `official_site_redirect` evidence row with status `validated`.

### Companies

`companies` rows are keyed by **verified domain** (for example `cohere.com`). One company can own several boards. Companies are never merged by name. An approved pending board gets no company link, because its domain was not verified.

### Manual review

On the Boards page, open **Board discovery**:
- **Approve** re-checks the board with the provider, then registers it under the employer name you enter.
- **Reject** records your reason.
- **Re-validate** queues a candidate for the next run.

Every decision is stored as `manual_review` evidence. A registered board can be disabled with the normal switch in the boards table.

## Running discovery

| Command | What it does |
|---|---|
| `npm run worker` | Runs scheduled discovery inside the worker when `PROREZ_DISCOVERY_ENABLED=true`, every `PROREZ_DISCOVERY_INTERVAL_HOURS`. |
| **Run discovery now** (Boards page) | Asks the worker to run within its poll interval (default 30 s). Works even with scheduling off. |
| `npm run discovery -- run` | Runs one discovery now in the terminal. Takes the same lease, so it never overlaps the worker. |
| `npm run discovery -- import <file> [--crawl CC-MAIN-2025-38] [--max 50000]` | Imports Common Crawl results. |
| `npm run discovery -- status` | Candidate counts, recent runs, search budget and next run. |

For the first Tavily pilot, keep registration off and bound the run explicitly:

```bash
PROREZ_DISCOVERY_AUTO_REGISTER=false PROREZ_DISCOVERY_MAX_QUERIES_PER_RUN=4 npm run discovery -- run
```

The JSON summary reports requests, credits, candidate URLs, unique/new candidates, verification outcomes and registrations. Inspect ownership evidence in **Boards → Board discovery** before manually approving any pending board.

**Priority (Milestone 3D).** Each run verifies candidates in this order:
1. careers pages of verified company domains;
2. Workday sites;
3. retries of temporary failures;
4. other careers pages;
5. everything else.

Search is skipped while at least twice the per-run batch of candidates is waiting, so credits are not spent while a backlog exists. `unsupported` careers pages are re-checked after 30 days.

Scheduling is durable: a single `discovery_schedule` row holds `next_run_at` and a lease, and is claimed atomically (the 3B pattern). Runs cannot overlap, which a unique index on running runs also enforces. A crashed run is recovered when its lease expires (30 minutes). Candidates being verified carry their own lease, so they are re-queued after a crash. Every run has a 20-minute limit.

Discovery runs in the worker process but in its own lane: board syncs are never blocked or slowed waiting for it.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROREZ_SEARCH_PROVIDER` | `tavily` | Search provider: `tavily` or `brave`. |
| `TAVILY_API_KEY` | — | Enables the default Tavily provider. |
| `BRAVE_SEARCH_API_KEY` | — | Enables Brave when `PROREZ_SEARCH_PROVIDER=brave`. |
| `PROREZ_DISCOVERY_ENABLED` | `false` | Scheduled discovery in the worker. |
| `PROREZ_DISCOVERY_INTERVAL_HOURS` | 24 | Time between scheduled runs (1–720). |
| `PROREZ_DISCOVERY_MAX_QUERIES_PER_RUN` | 10 | Search API requests per run (0–200). |
| `PROREZ_DISCOVERY_MAX_REQUESTS_PER_DAY` | 30 | Rolling 24-hour cap on search API requests (0–10000). |
| `PROREZ_DISCOVERY_MAX_CREDITS_PER_MONTH` | 900 | UTC calendar-month cap for Tavily credits (0–100000), using Tavily's reported `usage.credits`. |
| `PROREZ_DISCOVERY_MAX_CANDIDATES_PER_RUN` | 25 | Candidates verified per run (1–500). |
| `PROREZ_DISCOVERY_AUTO_REGISTER` | `true` | Register verified boards automatically. With `false`, they wait for approval. |
Invalid values stop the worker at start-up. The selected key stays on the server, is sent only as an authorization header to that provider's fixed HTTPS API host, and never reaches the browser. Tavily requests use `basic` search (one credit), return at most 20 results, disable answers/raw content/images, and translate each generated `site:` operator into `include_domains`. Tavily's 429 response is retried with bounded backoff; plan/credit-limit responses (432/433) stop search cleanly while other discovery sources continue.

Tavily's Researcher plan currently includes 1,000 monthly credits without a credit card. The 900-credit default leaves headroom and ProRez never enables pay-as-you-go. Provider allowances can change, so confirm the current plan before relying on it.

### Search queries

`lib/discovery/queries.ts` generates a bounded registry: ATS host × role area (software, embedded, systems, security, data/ML) × employment type (intern, co-op, new grad, junior) × place (Canada and major cities). Each run picks queries in this order:
1. queries never run before, spread across providers;
2. then the best yield per request: new candidates, plus 5 × boards verified.

Each query cools down for 7 days. Queries that cost 3+ requests and found nothing new cool down for 30 days. Statistics are kept in `discovery_queries`.

### Search API data use and retention

Tavily's output-storage guidance (reviewed November 2026) permits storing API outputs, while noting that rights in underlying publisher content still belong to its source. Tavily's privacy notice also says query data may sometimes be shared with third-party search providers. ProRez therefore sends only generic job-discovery queries and:
- uses result URLs only in memory, to recognise ATS boards;
- never stores result titles, snippets, ranks or result URLs;
- stores its own data: the canonical board identifier (independently verified against the ATS), and *which of its own queries* surfaced it (for yield statistics).

Review [Tavily's output-storage guidance](https://help.tavily.com/articles/1612400809-storing-caching-retaining-output), [privacy notice](https://www.tavily.com/privacy), and [terms](https://www.tavily.com/terms) for your own use. If Brave is selected, its more restrictive retention rules still apply; the same transient-only implementation satisfies both providers.

## Common Crawl

Common Crawl publishes a columnar URL index in Parquet. You can filter it for ATS hosts with any Parquet engine and import the result, without downloading crawl data. For example, with DuckDB (free; reads only the index columns it needs over HTTP):

```sql
-- One crawl; adjust the crawl id. Reads only the url_host_name and url columns.
INSTALL httpfs; LOAD httpfs;
COPY (
  SELECT DISTINCT url, fetch_time AS timestamp, 'CC-MAIN-2025-38' AS crawl
  FROM read_parquet('https://data.commoncrawl.org/cc-index/table/cc-main/warc/crawl=CC-MAIN-2025-38/subset=warc/*.parquet')
  WHERE url_host_name IN ('boards.greenhouse.io','job-boards.greenhouse.io','jobs.lever.co','jobs.eu.lever.co','jobs.ashbyhq.com','jobs.smartrecruiters.com')
  LIMIT 50000
) TO 'cc-ats.jsonl' (FORMAT JSON);
```

Then run `npm run discovery -- import cc-ats.jsonl`.

- Accepted formats: JSONL (`url`, `timestamp`, `crawl`), CSV (`url[,timestamp]`, with an optional header), or one URL per line.
- Limits: at most 50,000 rows (`--max`) and 200 MB per file. The file is streamed, so memory stays bounded.
- Rows are historical: every candidate is unverified until a discovery run checks it against the live ATS.
- The query above scans many index files; Common Crawl's AWS Athena tables are faster. Both are optional and not part of ProRez.

## Security

Discovery handles untrusted URLs. The outbound policy is:

- **ATS and search APIs:** fixed allow-listed hosts only, over https, with redirects refused (`lib/ats/http.ts`; `lib/discovery/search.ts`).
- **Company websites** (`lib/discovery/net.ts`):
  - https only, default port, no credentials, real DNS names only. IP literals, `localhost` and internal TLDs are refused.
  - The DNS answer is checked inside the socket's own lookup, and the connection uses exactly those addresses. That blocks private, loopback, link-local, CGNAT, multicast, reserved, documentation and IPv4-mapped IPv6 ranges, and defeats DNS rebinding.
  - At most 3 redirects, each re-validated. A redirect to an ATS board is recorded, not followed.
  - Pages are HTML only, capped at 4 MB (raised from 1 MB in Milestone 3D: real careers pages exceeded it) with a 10 s timeout and identity encoding.
  - `robots.txt` is obeyed (RFC 9309, up to 5 redirects). An unreachable robots.txt means "do not crawl".
  - Pages are never executed: only link attributes are read, as text.
- **Blocked or failed fetches** produce explicit failure evidence, never a false success.
- **Requests per run are bounded:** at most 3 domains × 4 pages per candidate, plus the search budget and the candidate batch size.
- ProRez does not bypass CAPTCHAs, logins or robots rules.

## Tests

- `lib/discovery/discovery.test.ts`: query registry, Tavily and Brave parsing/error handling, key and budget handling, config, status transitions, the SSRF policy (including DNS answers that resolve to private addresses), robots.txt, link and domain extraction, and import parsing.
- `lib/boards/board-url.test.ts`: URL recognition for all four providers, URL variants, Lever EU, and rejection of look-alike hosts.
- `tests/db/discovery.db.test.ts`:
  - pipeline: search → candidate → verification → registration → 3B sync; redirect ownership; pending review; rejection;
  - safety: idempotency, previously registered boards, concurrent registration and runs, several boards per company;
  - review: approve, reject and re-validate;
  - failures: partial and failed sources, missing key, daily budget, bounded retries, crash recovery, schedule persistence;
  - Common Crawl import.
- `e2e/discovery.spec.ts`: import → run → auto-registration with evidence → approval in the UI → "Run discovery now". Uses recorded ATS and website responses in `e2e/fixtures/`.
