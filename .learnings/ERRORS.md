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
