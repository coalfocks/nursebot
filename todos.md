# TODOs

- [x] Update frontend flows to capture/select `school_id` during room creation, assignment management, and dashboard filtering so the new multi-school schema is exercised end-to-end.
- [ ] Sync Supabase auth emails into `profiles.email` automatically (trigger or backend job) so admin tooling can safely filter by email.
- [ ] Delegate: Supabase migration + verification prompt for external LLM:
  ```
  You have full Supabase CLI and SQL access. Perform the following steps carefully and report every outcome:

  1. Fetch the latest commit from `main` and confirm the repository matches commit <INSERT_COMMIT_HASH_ON_HANDOFF>.
  2. Inspect `supabase/migrations/20250206000000_multi_school_support.sql` and `20250206001000_add_profile_email.sql` to confirm they are present and staged for execution.
  3. Run `supabase db push` against the **remote production project** using the environment variables provided in this session. Capture stdout/stderr.
  4. Verify the schema was updated:
     - Confirm the `schools` table exists with columns `(id uuid, name text, slug text unique, timezone text, created_at timestamptz)`.
     - Ensure `profiles`, `rooms`, `student_room_assignments`, `specialties`, and `chat_messages` now include the non-null `school_id uuid` column with the expected FK constraints and default.
     - Ensure `profiles.role` now enforces the enum-like check for `student | school_admin | super_admin`.
  5. Re-create or validate RLS policies defined in the migration; make sure no old policies remain active. List the policies on each table after the change.
  6. Validate data backfills:
     - Query `schools` for `slug = 'atsu-soma'` and note its UUID.
     - Confirm every existing `profiles`, `rooms`, `specialties`, `student_room_assignments`, and `chat_messages` row references that UUID.
     - Verify any `profiles.is_admin = true` rows now have `role = 'school_admin'` unless marked `super_admin`.
  7. Check the trigger functions `set_chat_message_school_id` and `set_assignment_school_id` exist and are attached to their tables.
  8. Smoke-test inserts:
     - Insert a temporary `profiles` row (role `student`) linked to the default school.
     - Insert a `rooms` row (with `school_id` specified) and a matching `student_room_assignments` row omitting `school_id` to confirm triggers backfill it.
     - Delete the temporary data when done.
  9. Verify the `profiles_email_key` unique index exists and `profiles.email` is populated from `auth.users.email` for all rows.
  10. Provide a final summary including executed commands, notable warnings, and follow-up actions.

  Use caution to avoid truncating logs. Abort immediately on errors and include the failing command output in your report.
  ```
