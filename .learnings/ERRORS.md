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
## [ERR-20261103-VITEST-FLAG] vitest_run_in_band

**Logged**: 2026-11-03T22:05:00Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The repository uses Vitest, which rejects Jest's `--runInBand` option.

### Error
```text
CACError: Unknown option `--runInBand`
```

### Context
- Attempted `npx vitest run src/lib/assignmentCreation.test.ts --runInBand`.
- The focused test passed when rerun as `npx vitest run src/lib/assignmentCreation.test.ts`.

### Suggested Fix
Use Vitest's supported CLI flags; do not pass Jest-only options.

### Metadata
- Reproducible: yes
- Related Files: src/lib/assignmentCreation.test.ts
- Tags: vitest, cli

---
## [ERR-20261103-CODEX-MODEL] codex_exec_model_name

**Logged**: 2026-11-03T16:11:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The installed Codex CLI account does not support the documented `gpt-5.3-codex` model name.

### Error
```text
The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.
```

### Context
- Attempted a one-shot implementation task in the nursebot repository.
- No repository changes were made by the failed invocation.

### Suggested Fix
Use the account's default model unless a supported model is explicitly configured.

### Metadata
- Reproducible: yes
- Related Files: none

---

## [ERR-20261029-GITREF] detached-head-push-refspec

**Logged**: 2026-10-29T22:14:00Z
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
Pushing a detached HEAD with `HEAD:fix/<branch>` was rejected because the destination was not a full refname.

### Error
```text
The destination you provided is not a full refname ... Did you mean to create a new branch by pushing to 'HEAD:refs/heads/fix/<branch>'?
```

### Context
- The commit was created successfully; only the push refspec failed.

### Suggested Fix
Use `HEAD:refs/heads/<branch>` for detached-worktree pushes.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: git, detached-head

### Resolution
- **Resolved**: 2026-10-29T22:15:00Z
- **Notes**: Re-pushed with the fully qualified refspec.

---

## [ERR-20261020-CODECREVIEWMODEL] codex_review_model

**Logged**: 2026-10-20T23:26:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The alternate model requested for independent Codex review is unsupported by the active ChatGPT account.

### Error
```text
The 'gpt-5.1-codex' model is not supported when using Codex with a ChatGPT account.
```

### Context
- Commit review was attempted for the isolated MAR candidate.
- The review did not start.

### Suggested Fix
Use the account-supported default reviewer or a separately configured review model.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: codex-cli, review, model-selection

---

## [ERR-20261020-CODECREVIEW] codex_review_args

**Logged**: 2026-10-20T23:25:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
Installed `codex review` rejects combining `--commit` with a custom prompt.

### Error
```text
the argument '--commit <SHA>' cannot be used with '[PROMPT]'
```

### Context
- Attempted independent review of the isolated MAR commit.
- No repository changes were made.

### Suggested Fix
Use the built-in commit review mode, or review `--base` with a custom prompt.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: codex-cli, review

---

## [ERR-20261020-SHELLQUOTE] codex_exec_prompt

**Logged**: 2026-10-20T23:22:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The shell rejected a follow-up `codex exec` prompt because an apostrophe in the prompt was not safely transported through single quotes.

### Error
```text
/bin/bash: -c: line 1: syntax error near unexpected token `make'
```

### Context
- Follow-up implementation request in the isolated MAR worktree.
- Failure occurred before Codex started and before repository edits.

### Suggested Fix
Use stdin or a double-quoted shell argument for prompts containing apostrophes.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: shell, codex-cli

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
## 2026-10-16

- `npm run test:run -- --runInBand` failed because Vitest does not support Jest's `--runInBand` option. Use `npm run test:run` for this repository.
## [ERR-20261020-CODEXCLI] codex_exec_flag

**Logged**: 2026-10-20T23:20:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
Installed `codex exec` does not accept the documented `--reasoning-effort` flag.

### Error
```text
error: unexpected argument '--reasoning-effort' found
```

### Context
- Attempted a delegated implementation run in the isolated MAR worktree.
- `codex exec --help` shows model selection but no reasoning-effort option.

### Suggested Fix
Use supported `codex exec` flags or configure reasoning in the active profile.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: codex-cli, tooling

---

## [ERR-20261020-CODEXMODEL] codex_exec_model

**Logged**: 2026-10-20T23:21:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The installed Codex CLI rejected an explicit `gpt-5.2-codex` model under the active ChatGPT account.

### Error
```text
The 'gpt-5.2-codex' model is not supported when using Codex with a ChatGPT account.
```

### Context
- Attempted the delegated implementation run in the isolated MAR worktree.
- The failure occurred before any repository edits.

### Suggested Fix
Use the CLI-configured default model for this account.

### Metadata
- Reproducible: yes
- Related Files: none
- Tags: codex-cli, model-selection

---
## [ERR-20261103-CODEX-FLAG] codex_exec_reasoning_flag

**Logged**: 2026-11-03T16:10:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The installed Codex CLI rejects the documented `--reasoning-effort` option.

### Error
```text
error: unexpected argument '--reasoning-effort' found
```

### Context
- Attempted `codex exec --reasoning-effort high ...` in the nursebot repository.
- `codex exec --help` shows model/config options but no reasoning-effort flag.

### Suggested Fix
Use the installed CLI's supported flags and keep skill documentation version-aware.

### Metadata
- Reproducible: yes
- Related Files: none

---
## [ERR-20261104-CODEXFLAG] codex_exec_flag_mismatch

**Logged**: 2026-11-04T19:37:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The installed Codex CLI does not support the documented `--reasoning-effort` flag on `codex exec`.

### Error
```text
error: unexpected argument '--reasoning-effort' found
```

### Context
- Attempted a scoped frontend regression implementation from the workspace root.
- `codex exec --help` confirms this installation supports `--model` but not `--reasoning-effort`.

### Suggested Fix
Use only flags reported by the installed `codex exec --help` output.

### Metadata
- Reproducible: yes
- Related Files: none

---
## [ERR-20261104-CODEXMODEL] codex_exec_model_unavailable

**Logged**: 2026-11-04T19:38:00Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
The installed Codex CLI rejected an explicit `gpt-5.3-codex` model under the active ChatGPT-backed provider.

### Error
```text
The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.
```

### Context
- The scoped frontend regression task was retried with an explicit model.
- The CLI session ended before editing files.

### Suggested Fix
Use the configured default model for this Codex CLI/provider combination.

### Metadata
- Reproducible: yes
- Related Files: none

---
## [ERR-20261104-VITESTDENO] full_vitest_deno_guard_loader

**Logged**: 2026-11-04T19:46:00Z
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
The full Vitest run cannot load the Deno consultant guard test because Node's ESM loader rejects its remote `https:` import.

### Error
```text
Only URLs with a scheme in: file and data are supported by the default ESM loader. Received protocol 'https:'
```

### Context
- `npm run test:run`: 56 passed suites, 1 failed suite, 234 passed tests.
- The failing suite is `supabase/functions/consultant-chat/guards.test.ts`; frontend and local Supabase tests passed.

### Suggested Fix
Run Deno-owned guard tests with Deno rather than including them in the Node/Vitest project-wide glob.

### Metadata
- Reproducible: yes
- Related Files: supabase/functions/consultant-chat/guards.test.ts

---
