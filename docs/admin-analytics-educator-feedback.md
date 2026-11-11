# Educator analytics feedback — November 11, 2026

## Changes

1. Consolidate eligible/completed attempts into Completed / assigned.
2. Rename Assessment coverage to Completed cases with feedback, with an explicit completed-attempt denominator.
3. Replace the assignment-created-to-completed median KPI with per-case elapsed medians from the persisted first nurse page (`scoring_start_at`) to completion. Includes pauses; never labeled active time. Exclude missing, malformed, and reversed pairs; show valid timing sample / completed count. Historical timing coverage is sparse, and no assignment-created fallback is used.
4. Export actual `.xlsx` workbooks (case performance, all filtered learner attempts, six domain subscores, definitions/scope). Remove the large on-page case-performance table. Learner attempts are collapsed at the bottom, paginated without a 100-row cutoff.
5. Show saved critical/concern safety flags with learner, case, rationale, recorded action, and a direct assignment-review link. Critical flags first. Do not infer real-world harm or derive a flag from a low composite score.
6. Cohort themes require evidence and at least 3 distinct learners by default, adjustable to 5. Duplicate comments and repeated attempts by one learner do not inflate counts. Selected-learner mode shows that learner's evidence-backed feedback without a cohort threshold. Only completed, assessed attempts contribute.
7. Place Communication and Clinical Reasoning first below summary cards, with six component averages, original ranges, and scored sample counts. Valid zero deductions are included; missing values remain unavailable.

## Boundaries

Existing authentication, school scoping, RLS, and test/sandbox filtering are retained. Every export is built from the same currently filtered rows as the dashboard. No scoring prompts, saved assessments, or backend functions are changed. Case aggregation keys use room ID, not room label, so equally named cases across schools remain separate. Exported user-provided text is a literal string cell, not an Excel formula.

## Verification

- 19 focused tests cover per-case timing, denominator and deduplication rules, missing/zero subscores, distinct-learner thresholds, explicit safety flags, pagination, school/learner scoping, named review navigation, and Excel export.
- Actual XLSX generation and ZIP/XML inspection verify four tabs and 125 learner rows plus header, with no formula cells for a learner name starting with `=`.
- Production build and changed-file ESLint pass. Full-repo lint/typecheck still fail in unrelated existing files; no diagnostics remain in changed analytics files.
- Headless Chrome visual review of the actual page rendered with synthetic data. No real learner information is included in QA artifacts.
- Review preview only; no production deployment or database writes.

## Deployment note

The PR branches from fetched `origin/main`. Current production also contains frontend feedback/timeline fixes from `dccf4d1` not present in that branch. Preserve those changes when preparing a production release; do not promote this review build wholesale as a production baseline.
