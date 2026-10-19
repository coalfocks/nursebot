# Errors

## [ERR-20261015-SUPABASE-INVOKE] supabase_functions_invoke

**Logged**: 2026-10-15T05:55:00Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
The installed Supabase CLI does not provide a `functions invoke` subcommand.

### Error
`Unknown subcommand "invoke" for "supabase functions"`

### Context
The deployed `generate-feedback` function needed a live synthetic invocation. Deployment succeeded, but the local CLI version only supports function list/deploy/download/delete/serve.

### Suggested Fix
Use the Supabase function HTTPS endpoint with an authenticated service-role request or the project’s supported dashboard/API invocation path; do not assume CLI parity with newer versions.

### Metadata
- Reproducible: yes
- Related Files: supabase/functions/generate-feedback/index.ts

---

## [ERR-20261015-SUPABASE-TARGET] supabase_apply_migration

**Logged**: 2026-10-15T20:30:00Z
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
The first migration attempt targeted the shared-context Supabase project instead of the Nurse Althea project.

### Error
```text
ERROR: 42P01: relation "public.student_room_assignments" does not exist
```

### Context
The migration was attempted with project `pwkyryytprkpxjktgwyv`, but the repository is linked to `lvpbwtfvairspufrashl` in `supabase/.temp/linked-project.json`. The target rejected the DDL before applying it; no schema change was made.

### Suggested Fix
Read the repository's linked project reference before applying migrations and verify the target schema contains the application tables.

### Metadata
- Reproducible: yes
- Related Files: `supabase/.temp/linked-project.json`, `supabase/migrations/20261015203500_fix_test_room_session_launch.sql`
- Tags: supabase, project-target, migration

---

## [ERR-20261015-WORKDIR] exec_command

**Logged**: 2026-10-15T16:20:00Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
An idempotent library-content reapply was initially pointed at a mistyped working directory.

### Error
`Failed to create unified exec process: No such file or directory`

### Context
The database was not reached and no data changed; the same command was rerun from `/home/skribert/clawd/nursebot` successfully.

### Suggested Fix
Validate the repository working directory before launching linked Supabase CLI commands.

### Metadata
- Reproducible: no
- Related Files: scripts/seed-student-library-preview.sql

---

## [ERR-20261015-VITEST] unsupported_test_flag

**Logged**: 2026-10-15T21:27:00Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The first verification command passed the Jest-only `--runInBand` flag to Vitest.

### Error
```text
CACError: Unknown option `--runInBand`
```

### Context
- Command: `npm test -- --runInBand`
- Repository runner: Vitest

### Resolution
- Re-ran with `npm run test:run`; all 146 tests passed.

---
## [ERR-20261019-VITEST]

**Logged**: 2026-10-19T10:53:47Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Vitest rejected the Jest-only `--runInBand` option during the first targeted MAR test invocation.

### Error
```text
CACError: Unknown option `--runInBand`
```

### Context
- First command: `npx vitest run src/features/emr/lib/marSchedule.test.ts --runInBand`
- Correct command: `npx vitest run src/features/emr/lib/marSchedule.test.ts`

### Suggested Fix
Use Vitest's native single-file command without Jest flags.

### Metadata
- Reproducible: yes
- Related Files: src/features/emr/lib/marSchedule.test.ts
- Tags: vitest, cli

---
