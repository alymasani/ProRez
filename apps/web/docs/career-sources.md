# Workday and company career sites (Milestone 3D)

ProRez syncs jobs from six kinds of career source. All of them are rows in the same `employer_boards` table and go through the same 3B worker, reconciliation and sync history ([ats-sync.md](ats-sync.md)):

| Source | Provider | Identity (`board_token`) | How jobs are read |
|---|---|---|---|
| Greenhouse, Lever, Ashby, SmartRecruiters | `greenhouse` … | board token (`acme`) | official public APIs (3A) |
| Workday career site | `workday` | `{tenant}[.wdN]/{site}`, or `wdN.myworkdaysite/{tenant}/{site}` | the site's public JSON ("CXS") |
| Company careers page | `company_site` | canonical URL without scheme (`acme.ca/careers`) | generic extraction (below) |

A company (`companies`, keyed by verified domain) can own any number of sources.

## Adding sources

- **Import a careers page** (Boards page): paste any public careers URL. ProRez detects what it is and shows a preview: source type, canonical URL, company, verification status, extraction method, jobs detected, description completeness and listing completeness. You can then register it. The server re-runs the check at registration, and a careers page is registered only when real jobs were extracted.
  - **ATS or Workday URLs:** board, posting, embed and API URLs all work.
  - **A company page that links to, or redirects to, a supported board:** it is routed to that board's adapter.
  - **Any other page:** generic extraction.
- **Add a board by identifier:** the token form for the four ATS providers, unchanged from 3A.
- **Discovery** (worker; [discovery.md](discovery.md)) finds Workday sites and careers pages automatically.

## Workday

### URL formats

| Format | Example |
|---|---|
| Career site | `https://acme.wd3.myworkdayjobs.com/[en-US/]External` |
| Posting | `https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer-Intern_R123` |
| Hosts without a cluster | `https://acme.myworkdayjobs.com/Careers` |
| Shared hosts | `https://wd5.myworkdaysite.com/[en-US/]recruiting/acme/Campus` |
| JSON endpoints | `https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs` |

How these URLs are interpreted:
- **Host matching:** hosts are matched label by label (`{tenant}.wd{digits}.myworkdayjobs.com`), never by substring. The cluster list is not assumed to be complete: any `wd{digits}` is accepted.
- **Identity:** a tenant can publish several career sites (`External`, `Campus`…), so the identity is tenant + site, never the tenant alone.
- **Locale:** the locale (`en-US`, `fr-CA`) is presentation only. It is stored as information and is not part of the identity, so the same site in several locales is one source.
- **Case:** site ids and posting ids are stored lowercase, because Workday treats them case-insensitively.

### Extraction

1. **Robots check.** robots.txt of the Workday host is checked first, and a disallow stops the sync.
2. **Listing.** `POST /wday/cxs/{tenant}/{site}/jobs` with `{limit: 20, offset}`, paged. `total` is reported on the first page only.
3. **Details.** `GET /wday/cxs/{tenant}/{site}{externalPath}` returns the full description, every location, time type and requisition id. Details are capped per sync (`PROREZ_WORKDAY_MAX_DETAILS`, default 60), in this order:
   1. postings without a stored description;
   2. then postings whose listing mentions Canada, or "N Locations";
   3. then the rest.

   Postings not detailed this run keep their stored description, so they are not treated as changed.
4. **Posting identity.** The id is the last path segment (`software-developer-intern_r123`), unique per posting within the site. The requisition id is kept as metadata, because one requisition can have several postings.

Requests are paced (`PROREZ_WORKDAY_MIN_INTERVAL_MS`, default 250 ms) and sent through the allow-listed transport: https only, no redirects, no cookies, no authentication. HTTP 401 or 403 is reported as "refused access" and is never worked around.

### Completeness

A Workday listing is complete only when all of the following hold:
- every page up to the first page's `total` was read;
- no page came back short;
- no listing item was unreadable;
- the number of distinct postings equals `total`;
- the page cap was not reached;
- **`total` is below 2,000.**

Live testing showed that Workday's listing continues past offset 2,000 while `total` still says 2,000. A site that large can therefore never prove completeness, and its jobs are never expired.

Description enrichment is tracked separately. A run whose listing is complete can still have deferred descriptions (`board_sync_runs.description_complete`).

### Limitations

- The CXS JSON is what the public career site itself uses. **It is not a documented, stable API**, so a schema change fails loudly rather than producing guessed data.
- Tenants on custom domains (for example `careers.acme.com`, served by Workday) are reached only through a link or redirect to a `myworkdayjobs.com` URL.
- Sites that require sign-in, or that hide jobs behind search-only listings, are not supported.

## Generic careers pages

`lib/careers/extract.ts` runs these strategies in order and stops escalating as soon as one finds jobs:

1. **JSON-LD `JobPosting`** (`lib/careers/jsonld.ts`):
   - **Formats:** objects, arrays, `@graph` and nested values, all read as text with `JSON.parse` (never executed).
   - **Validation:** malformed blocks are skipped and counted, and invalid postings (no title) are rejected. Missing fields stay empty.
   - **Description text:** HTML descriptions, including entity-encoded ones, are converted to plain text.
2. **Sitemaps** (`lib/careers/sitemap.ts`), only when the careers page lists nothing:
   - `Sitemap:` lines in robots.txt, or `/sitemap.xml`; career-looking child sitemaps are read first, at most 4 documents.
   - Only same-site URLs that look like individual postings are kept.
3. **Static HTML** (`lib/careers/static.ts`). Pages are read as text with reusable heuristics; there are no site-specific selectors.
   - **Links:** job-detail links on the same site, with a job-like path and a further segment or id, and title-like anchor text. Navigation, articles, assets and other sites are excluded.
   - **Pagination:** `rel="next"` and "Next" links are followed.
   - **Each job page:** read for JSON-LD first, then for a title, description, location and apply link from the page itself. A page counts as a job only with a job-like title and a description that reads like a job, so marketing pages are rejected.
4. **Browser rendering** (optional; `lib/careers/render.ts`). Used only when strategies 1 to 3 found nothing; see below.
5. **Unsupported.** No jobs and no route to an ATS. The source is marked `unsupported` (discovery) or refused (import), with diagnostics. Nothing is invented. A registered source that later yields nothing is synced as "partial" with zero jobs: it is not disabled and nothing is expired.

**Routing comes first.** If the careers page links or redirects to a Greenhouse, Lever, Ashby, SmartRecruiters or Workday board, that board is used through its own adapter. The page is not scraped.

**Posting identity:**
- `id:{identifier}` when the JSON-LD has a usable identifier;
- otherwise `u:{path+query}` of the canonical job URL, with tracking parameters removed;
- `h:{hash}` for very long URLs.

Distinct postings with the same title have different URLs, so they are never merged.

### Completeness (generic)

A generic snapshot is **incomplete by default**. It is complete only when every one of these holds:
- the jobs were enumerated from the careers page itself;
- **every job is backed by structured `JobPosting` data.** Live testing found heuristic HTML matches that were category pages ("Interns & Graduates"), so heuristic matches can never prove exhaustiveness;
- all pagination was followed, and there are no "load more" or numbered controls ProRez cannot follow;
- every job page was fetched;
- no linked page was rejected as a non-job;
- no cap was reached.

Static-heuristic, sitemap and rendered enumerations are never treated as complete. Only complete snapshots can mark postings missing; the two-snapshot inactivation rule of 3B still applies. Stored descriptions are never overwritten with empty text.

### Validation and confidence

A job needs all of the following:
- a stable identity;
- a title;
- a canonical https job URL on the source's site;
- evidence that it is a job (a JobPosting schema, or a job-detail URL with a job-like page).

Then the usual 3B filters apply: Canadian location and an entry-level role.

The signals recorded per job (`json_ld_jobposting`, `identifier`, `full_description`, `job_detail_url`, `apply_link`) help with review. **They are not a score threshold for verification.**

## Ownership and registration safety

Automatic registration requires all of the following:
1. the source is reachable;
2. jobs were extracted (a careers page), or the board answered (ATS or Workday);
3. the company is verified;
4. the identity is stable;
5. the extraction fits the configured limits.

How a company is verified:
- **ATS and Workday boards:** the company's own website links to the board, or its careers page redirects there (3C rules). A careers page that routed discovery to a board is the first domain checked.
- **Careers pages:**
  - a page served from the company's own registrable domain (`acme.ca/careers`, `www.acme.ca/careers`) is that domain's careers page;
  - a careers **subdomain** (`careers.acme.ca`) additionally needs `acme.ca` to link to it;
  - pages on third-party platforms (job boards, hosted ATS domains) never verify a company.

Anything else waits in **Needs review**. Name similarity, search results or a valid URL alone never establish ownership.

## Browser rendering (optional)

Rendering is off by default. Enable it for the worker with `PROREZ_RENDER_ENABLED=true` after `npx playwright install chromium`. It is never used inside the web server: previews run without rendering.

| Control | Setting |
|---|---|
| Isolation | Headless Chromium, a fresh context per render, downloads off, service workers blocked, dialogs dismissed, pop-ups closed. Downloaded scripts run only inside the browser sandbox. |
| Network | All browser traffic goes through an in-process CONNECT proxy, with Chromium's implicit loopback bypass removed. The proxy accepts only `:443` to hosts that pass the URL policy, resolves them with the vetted DNS lookup (public addresses only) and connects to exactly that address. localhost, private ranges, cloud metadata and DNS rebinding are refused. A test renders through a DNS answer of `127.0.0.1` and checks that the proxy refuses it. |
| Robots and resources | robots.txt is checked per request. Images, media, fonts, stylesheets and sockets are not loaded. |
| Limits | `PROREZ_RENDER_TIMEOUT_SECONDS` (20), `PROREZ_RENDER_MAX_REQUESTS` (150), `PROREZ_GENERIC_MAX_RENDERS` per sync (3), `PROREZ_RENDER_CONCURRENCY` (1 per process). Rendering never blocks ATS syncs, because company sites have their own provider concurrency slot. |

## Crawl policy and limits

Every company-site request goes through `lib/discovery/net.ts`:
- https only, no IP literals or internal names;
- vetted DNS, at most 3 redirects, each re-checked;
- robots.txt (RFC 9309), with an unreachable robots.txt meaning "do not crawl";
- 4 MB per HTML page, 5 MB per sitemap, 10 s timeout;
- per-host pacing (`PROREZ_GENERIC_MIN_INTERVAL_MS`, 1 s).

| Setting | Default | Meaning |
|---|---|---|
| `PROREZ_GENERIC_MAX_LISTING_PAGES` | 5 | Pagination pages per sync. |
| `PROREZ_GENERIC_MAX_JOB_PAGES` | 40 | Job pages per sync; more makes the snapshot incomplete. |
| `PROREZ_GENERIC_MAX_RENDERS` | 3 | Browser renders per sync. |
| `PROREZ_WORKDAY_MAX_LISTING_PAGES` | 100 | Listing pages of 20 (2,000 postings). |
| `PROREZ_WORKDAY_MAX_DETAILS` | 60 | Detail requests per sync. |
| `PROREZ_WORKDAY_MIN_INTERVAL_MS` | 250 | Pause between Workday requests. |

Discovery verification uses smaller limits (2 listing pages and 10 job pages for careers pages; 3 listing pages and 8 details for Workday). Syncs of Workday and company sites have a 5-minute limit; ATS syncs keep 2 minutes. Each provider has one sync at a time per worker (`PROREZ_WORKER_PROVIDER_CONCURRENCY`).

ProRez does not bypass CAPTCHAs, logins, robots.txt, bot protection or access controls. Blocked sources are reported as such.

## Database (migrations `20261120000000`–`20261120000002`, additive)

- **Enum values:** `source_provider` gains `workday`; `discovery_candidate_status` gains `unsupported`; `discovery_source` gains `career_page` and `company_domain`; `discovery_evidence_type` gains `career_page_extraction` and `routed_to_ats`.
- **`employer_boards`:**
  - new columns `locale`, `extraction_strategy`, `source_config`, `last_complete_snapshot_at`;
  - token format rules per provider;
  - provider check widened.
- **`board_sync_runs`:** new columns `extraction_strategy`, `pages_fetched`, `description_complete`.
- **`discovery_candidates`:** new columns `locale`, `extraction_strategy`, `source_config`; same per-provider rules.
- **`source_observations`:** Workday and company-site sightings use the same (provider, board, posting) identity.
- **Job source row:** a `job_sources` row for Workday (`src-workday`).

Existing rows are unchanged.

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| "robots.txt disallows …" | The site does not permit crawling that path. ProRez respects it; the source is paused. |
| "refused access (HTTP 403)" | The site blocks automated access or needs sign-in. Not supported. |
| Import says "No job postings could be extracted" | Try the page that actually lists the jobs. If jobs appear only after JavaScript runs, enable rendering for the worker; previews do not render. |
| Sync is "partial" for a careers page | Normal unless completeness was proven. Jobs are imported; nothing is expired. |
| "This careers page now leads to …" | The company moved to a supported ATS. Import that board; the old source is paused. |
| Workday "reports at most 2000 postings" | A very large site. It syncs normally, but absent postings are never expired. |

## Compatibility evaluation (measured 2026-11-12)

The evaluation was read-only (no database writes), respected robots.txt and was paced. Sites were chosen to span banking, insurance, semiconductors, software, retail, games, media and education. They were not filtered for ease: failures are listed. **These numbers describe this sample only; ProRez does not claim universal or 99% coverage.**

### Workday: 12 career sites

RBC, TD, BMO, CIBC, Manulife, Sun Life, NVIDIA, Intel, Salesforce, Adobe, Thomson Reuters, Mastercard.

| Measure | Result |
|---|---|
| Recognised | 12 / 12 |
| Listing parsed | 12 / 12 (251–1,999 postings per site) |
| Provably complete listing | 11 / 12. NVIDIA (≥ 2,000 postings) is incomplete by design. |
| Full description on detailed postings | 59 / 60 (5 detailed per site) |
| Identity stable across two runs | 12 / 12 (40 / 40 ids each) |
| Requests per sync, mean | 54 (listing pages plus 5 details) |
| Time per sync, mean | 61 s (16–135 s) |

Two bugs were found and fixed during this run:
- **The 2,000 cap.** Workday reports `total = 2000` while the listing continues past it. Such a snapshot was previously treated as complete.
- **Rejected ids.** Posting ids starting with `_` or `-` (non-Latin titles) were rejected, which made BMO, Manulife and Mastercard incomplete.

### Company careers pages: 26 sites

The sample included Shopify, Amazon, Netflix, IBM, EA, Ubisoft, OpenText, CGI, Wealthsimple, Cohere, StackAdapt, Lightspeed, Coveo, D2L, Kinaxis, Hootsuite, Clio, Faire, 1Password, Benevity, Ritual, theScore, KOHO, Docebo, McGill and CBC. Rendering was enabled.

| Outcome | Sites | Notes |
|---|---|---|
| Jobs extracted | 5 (19%) | Shopify (static HTML), Amazon (rendered), IBM (rendered), Lightspeed (sitemap), Coveo (JSON-LD) |
| Routed to a supported board | 8 (31%) | 6 to Ashby, 1 to Greenhouse, 1 to Workday (McGill) |
| Unsupported | 9 (35%) | Netflix, EA, Ubisoft, CGI, D2L, Kinaxis, Clio, Faire, Ritual: jobs come from unsupported systems or client-side apps with no extractable links |
| Blocked / unreachable | 4 (15%) | HTTP 400/404 at the URL tried (3); CBC's robots.txt unreachable, so not crawled |

Summary of the careers-page sample:
- **Usable:** 13 of 26 sites (50%) were either extracted or routed.
- **Descriptions:** 27 of 29 extracted jobs had a full description (93%).
- **Identity:** every extracted id was stable across two runs.
- **Completeness:** no generic snapshot was provably complete, so jobs are never expired for these sites.

Two fixes came out of this run:
- **False positives.** Category pages ("Applied Machine Learning Engineers", "Interns & Graduates", "Join our Internships Team") were accepted as jobs. Category titles are now rejected, and heuristic HTML jobs can no longer make a snapshot complete.
- **Page size.** The 1 MB page cap blocked real careers pages; it is now 4 MB.

### Four headline rates (both samples, 38 sites)

| Rate | Workday | Careers pages |
|---|---|---|
| Career sites recognised (a supported source identified) | 12/12 (100%) | 13/26 (50%) |
| Career sites successfully parsed | 12/12 (100%) | 5/26 extracted (19%); 13/26 including routed boards (50%) |
| Jobs with complete descriptions | 59/60 (98%) | 27/29 (93%) |
| Eligible for safe automated sync | 12/12 synced safely, 11/12 with provably complete listings | 5/26 synced safely; 0/26 provably complete (never expire) |

### Live discovery pilot (disposable test database)

The pilot used 6 Tavily queries in total:
- 2 Workday queries;
- 2 careers-page queries that failed with HTTP 400 (a bug, now fixed);
- the same 2 careers-page queries re-run after the fix.

| Result | Count |
|---|---|
| Distinct Workday sites found | 32 |
| Auto-registered with ownership evidence | 15 (9 before the tenant-name hint was added, 6 more after) |
| Waiting for review | 17 |
| Usable careers-page URLs from the 2 careers-page queries | 0 |
| Company-domain `/careers` probes (verified companies) | 9: 5 routed to that company's Workday site, 4 returned 404 at that path |
