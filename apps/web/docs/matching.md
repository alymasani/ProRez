# Matching engine

The engine decides which search profiles a job satisfies. It's deterministic: there's no LLM and no I/O, and the same inputs always give the same output. Code: `lib/matching/` (rules in `engine.ts`, rules version `MATCHING_ENGINE_VERSION`).

## Outcomes

Each (job, profile) pair runs every criterion as a **check**: `pass`, `fail`, `unknown` (data missing or ambiguous) or `not_applicable`.

| Hard checks | Outcome |
| --- | --- |
| any `fail` | **ineligible** (not stored) |
| no fail, any `unknown` | **needs_review**: stored and shown, but never notified automatically |
| otherwise | **eligible** |

Missing or ambiguous data never passes silently. It becomes `needs_review`, with a reason shown on the job page.

## Hard constraints

| Criterion | Rule |
| --- | --- |
| Employment type | The job's type must be selected. Types are `new_grad`, `junior`, `internship` and `co_op`. |
| Internship duration | Applies only to internships and co-ops, and only when durations are selected. Buckets: ≤4 months, ≤8 months, 12+ months. A **missing duration** is `unknown`, unless the profile includes "Not specified". |
| Location | Passes if **any** job location has an allowed arrangement **and** an allowed province. "Remote anywhere in Canada" accepts remote roles outside the selected provinces, but never overrides an arrangement restriction. Empty lists mean anywhere in Canada / any arrangement. |
| Target titles | The title must contain at least one phrase. Matching is whole-phrase and accent-insensitive, so "intern" does not match "internal". |
| Excluded title words | The title must contain none of them. |
| Excluded keywords | The title, summary, responsibilities and qualifications must not mention any. |
| Disciplines | The job must share at least one. A job with no disciplines is `unknown`. |
| Experience level | Implied by job type: intern/co-op → student, `new_grad` → new graduate, `junior` → junior. |
| Max years of experience | Parsed from the posting text ("2–4 years", "3+ years", "two years", "no experience required"). Above the limit → fail. **Ambiguous** text (several different numbers that straddle the limit, e.g. "0–2 years; 3+ preferred") → `unknown`. **Not stated** → pass for intern/co-op/new-grad roles, `unknown` for junior roles. |

Dismissed and expired jobs aren't evaluated at all.

## Soft relevance signals

These only rank profiles. They never change eligibility.

- **Preferred keywords** (weight 2): the fraction of keywords found anywhere in the posting.
- **Discipline overlap** (weight 1): the share of the job's disciplines that the profile selects.

Relevance is 0–100, or null when the profile has no soft signals. It is **not** the candidate-fit score.

## One canonical result per job

All active profiles (enabled and not archived) are evaluated together. The matching profiles are ranked: eligible before needs-review, then by relevance, then oldest profile first. That gives one `job_profile_evaluations` row per job and one `job_profile_matches` row per matching profile. Rank 0 is the **primary** profile, whose automation mode governs the job.

Each match stores the **profile version** it was evaluated against. Version snapshots (`search_profile_versions`) are immutable, so past results stay explainable after a profile is edited.

## Notifications (planned; nothing is sent yet)

`lib/matching/notifications.ts` decides which jobs *would* notify:

- at most one notification per job, however many profiles match;
- at most one per dedupe key (the same posting stored twice);
- never again once `notified_at` is set;
- only for eligible matches whose profile has notifications on;
- candidate fit is checked here, **separately from eligibility**: unscored jobs wait, and the highest-ranked profile whose minimum fit is met is chosen.

## When matching runs

After every profile create, update, enable/disable or delete, and when demo data is seeded. Runs are serialised with a Postgres advisory lock.

Evaluations that already produced a notification are **frozen** and never recomputed. That frozen history is what forces a deleted profile to be archived instead of removed.
