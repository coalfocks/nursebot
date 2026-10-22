# `materialize_hospital_timeline` readback

Read-only evidence captured 2026-10-22 UTC for production Supabase project
`lvpbwtfvairspufrashl` (`sb1-v84f4fhg`). No production rows or schema were
changed.

## Migration ledger

`supabase migration list --linked` returned:

```text
20261021130000 | 20261021130000 | 2026-10-21 13:00:00
20261021141147 | 20261021141147 | 2026-10-21 14:11:47
20261021224401 |                | 2026-10-21 22:44:01
```

The last line is local-only. Review packet `20261021224401` is not applied
remotely. The held `20261019*` chain remains unapplied remotely.

## Production function and indexes

The remote schema dump captured the function identity and body. The live body
contains these four stale targets:

```sql
on conflict (room_id, timeline_entry_id)
where timeline_entry_id is not null and deleted_at is null
```

Production has these four unique partial indexes:

```sql
clinical_notes_room_timeline_entry_uidx
  (room_id, timeline_entry_id)
  WHERE room_id IS NOT NULL AND timeline_entry_id IS NOT NULL AND deleted_at IS NULL
lab_results_room_timeline_entry_uidx
  (room_id, timeline_entry_id)
  WHERE room_id IS NOT NULL AND timeline_entry_id IS NOT NULL AND deleted_at IS NULL
vital_signs_room_timeline_entry_uidx
  (room_id, timeline_entry_id)
  WHERE room_id IS NOT NULL AND timeline_entry_id IS NOT NULL AND deleted_at IS NULL
imaging_studies_room_timeline_entry_uidx
  (room_id, timeline_entry_id)
  WHERE room_id IS NOT NULL AND timeline_entry_id IS NOT NULL AND deleted_at IS NULL
```

This exactly explains the verified `42P10`: the conflict target predicate
does not imply the index predicate because it omits `room_id IS NOT NULL`.

Captured prior function body is preserved in the remote schema dump used for
rollback review. Its complete body is the version in migration
`20261015193000_relative_hour_baseline_timeline.sql`; the decisive four
statements are:

```sql
on conflict (room_id, timeline_entry_id) where timeline_entry_id is not null and deleted_at is null do update set ...;
```

The four occurrences are in the `clinical_notes`, `lab_results`,
`vital_signs`, and `imaging_studies` branches. Rollback, if ever approved,
means restoring that captured `CREATE OR REPLACE FUNCTION` body only; it does
not drop indexes or rewrite chart rows.

## Grants and preflight

Remote schema dump shows:

```sql
REVOKE ALL ON FUNCTION public.materialize_hospital_timeline(
  integer, uuid, uuid, uuid, jsonb, text, timestamptz
) FROM PUBLIC;
GRANT ALL ON FUNCTION public.materialize_hospital_timeline(
  integer, uuid, uuid, uuid, jsonb, text, timestamptz
) TO authenticated;
GRANT ALL ON FUNCTION public.materialize_hospital_timeline(
  integer, uuid, uuid, uuid, jsonb, text, timestamptz
) TO service_role;
```

Owner-only preflight before any application of `22401` must verify the exact
function identity, four index predicates, zero duplicate active provenance
keys, the authenticated execute grant, and the relevant RLS policies. The
packet must stop if any check differs.

## Isolated regression transcript

[`supabase/tests/20261022_materialize_hospital_timeline_conflict.sql`](../../supabase/tests/20261022_materialize_hospital_timeline_conflict.sql)
creates temporary tables with the exact production index predicates, asserts
the stale target raises `42P10`, applies the corrected target to all four row
types, replays each provenance key, and asserts one row per type with updated
content. It ends with `ROLLBACK`; it is not a production test and was not run
against room 118.

The stronger exact-schema runner is
[`scripts/qa/run-materialize-hospital-timeline-isolated.sh`](../../scripts/qa/run-materialize-hospital-timeline-isolated.sh).
It performs a read-only linked public-schema dump, restores it into disposable
PostgreSQL, copies the unchanged review migration and captured prior function,
checks the four indexes/function/grant/column contract, and records stdout and
stderr in
[`2026-10-22-materialize-hospital-timeline-exact-schema.transcript.txt`](./2026-10-22-materialize-hospital-timeline-exact-schema.transcript.txt).
The committed transcript now includes the exact pre-compatibility column/type
readback. It shows `lab_results.case_blueprint_id` is absent while the current
function's lab branch inserts and updates it. The preserved error is
`SQLSTATE=42703` / `SQLERRM=column "case_blueprint_id" of relation "lab_results" does not exist`.

The minimal compatible dependency is a separate review-only packet,
[`20261022032351_add_lab_results_case_blueprint_provenance.sql`](../../supabase/migrations/20261022032351_add_lab_results_case_blueprint_provenance.sql):
nullable `uuid` `lab_results.case_blueprint_id`, FK to
`case_blueprints(id) ON DELETE SET NULL`, and a lookup index. It preserves
school/room/patient/provenance semantics and adds no data. It is not applied
remotely, and is intentionally separate from `20261021224401`.

The hardened runner restores the schema with `ON_ERROR_STOP=1` and fails on
restore errors. Its disposable transcript proves: `BEFORE 42P10: PASS`;
RLS, authenticated table grants, authenticated author-scope policy, and anon
function denial checks; intended wrong-patient failure with captured
`SQLSTATE=P0001` and zero chart residue; after the unchanged conflict-target
repair plus the compatibility packet, all four branches return `1/1/1/1`;
retry leaves exactly one row per provenance key; and the captured prior
function body restores successfully. Production remains untouched.

Current evidence hashes from the transcript:

- `20261021224401`: `abc74244a69e5749fa935d3d3b09a28010e934a520a84c6a3bb0871f21e4d76a`
- compatibility packet: `85d59be3f8ebf1a9cb6ffb40828fa2482ac02d2e1360e54ea70065013f1428b7`
- captured prior function: `0def57e4f38becc90276894dc5963adcc3b68f72d77a7e7dacffc5a916020d1f`
- linked public schema dump: `5e80e2c40797f180e81eb64802fdf4fd5d4108c0c49d60ba746567248152f7b9`

The temporary-table file above remains explicitly predicate-shape coverage
only; the exact-schema runner is the branch/retry/rollback evidence.
