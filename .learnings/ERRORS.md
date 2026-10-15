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
