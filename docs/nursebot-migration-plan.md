# Nursebot migration and rollback plan

## Preservation input

Use [2026-10-02-authored-room-cases.json](snapshots/2026-10-02-authored-room-cases.json) as the immutable comparison input for this work. Never use historical audit prose as an overwrite source. Compare row counts, IDs, room-to-patient links, school IDs, difficulty, prompts, and clinical values before any active-case write.

## Planned migration stages

### Stage 1: read/write correctness

- Add immutable patient/encounter identity to every chart request and component load generation.
- Reject late responses whose patient, room, assignment, or request generation no longer matches the visible chart.
- Add version/concurrency columns only where the existing tables lack an equivalent; preserve existing IDs.
- Make create return the complete committed row and make immediate edits wait for that row.
- Add idempotency for retryable creates and explicit pending/saved/failed UI states.
- Add the room 401 lab recovery fixture only after reproducing its current read/write path.
- The October 7 scope-hardening slice adds database-side patient/room/assignment identity validation and role-aware EMR RLS. It does not rewrite existing authored rows or learner sessions.

### Stage 2: clinical projections and isolation

- Establish one canonical medication-order projection and keep legacy written regimens visible until migrated.
- Separate authored scenario baseline from assignment/session state; pin assignments to a scenario/version.
- Add typed lab values and explicit result lifecycle/time transitions without coercing narrative or pending results.
- Build typed nurse, EHR, bedside, and hidden-evaluation context constructors.

### Stage 3: authoring and verification

- Add reversible editors, import previews, amendment/supersession history, and scoped export/import.
- Add student preview and the named-room regression manifest.
- Add patient-background fields only when connected to the actual patient-chat request builder.

## Rollback

1. Stop writes to the affected migration path behind its feature flag or route guard.
2. Restore the prior code release without deleting authored rows.
3. If a schema migration was applied, use a forward rollback migration or restore from the pre-migration snapshot; never rewrite the authored snapshot in place.
4. Reconcile by immutable IDs and versions, then verify room/patient links and clinical values against the snapshot.
5. Keep learner-session rows untouched unless the incident is specifically session data corruption.

## Verification gates

- Dry-run on a copy or isolated school scope first.
- Compare counts and identifiers before/after.
- Run focused tests, build, lint/typecheck baselines, and named-fixture read-back checks.
- Do not claim a case is verified from an admin Save toast; reopen and read the committed row and student preview.
