# Isolated single-attempt evaluation proof

This branch adds an additive, non-learner evaluation store and a server-owned
single-attempt workflow. It is not a production release and the migration is
review-only until explicitly approved.

## Local proof

1. Start the local Supabase stack and apply the normal local migrations, then
   apply `supabase/migrations/20261024210000_isolated_evaluation_versions.sql`.
2. Seed one completed synthetic `student_room_assignments` row, its patient,
   room, assignment-scoped timeline rows, a SuperAdmin, and one active
   `feedback_evaluator_configs` row whose prompt and anchors exactly match the
   reviewed NEW-FORMAT candidate.
3. Start the local function with:

   ```sh
   FACULTY_STUDY_DEPLOYMENT_MODE=study-enabled \
   FACULTY_STUDY_EVALUATOR_MODE=deterministic \
   GENERATE_FEEDBACK_REVISION=local-deterministic-v1 \
   supabase functions serve faculty-study-feedback --env-file .env.local
   ```

4. Authenticate as the seeded SuperAdmin and open
   `/admin/faculty-study?assignment_id=<synthetic-completed-assignment-id>`.
5. Click **Rerun evaluation**. The UI sends only the assignment ID and an
   idempotency key. The server resolves the completed snapshot and config,
   creates v1, claims it, runs the deterministic adapter, and stores JSON,
   CSV, and printable HTML artifacts.
6. Reload the page and click **Download evaluation** on v1. Repeat the
   download; the stored artifact bytes are returned without another evaluator
   call.
7. Submit two identical queue requests concurrently. The RPC returns one
   active version. After v1 is completed, a new idempotency key creates v2;
   v1 and all learner columns remain unchanged.
8. Delete or invalidate the synthetic historical baseline and repeat. The
   result is persisted as `blocked`/`error` with an explicit reason; it is not
   silently replaced by a current case or old feedback.

The `rerun_batch` action accepts only a validated frozen 1–30 manifest and
queues the same per-attempt service with stable `batch:<key>:<ordinal>` keys.
It is unavailable in preflight-only mode. Individual reruns never require a
manifest.

Production remains preflight-only. No production migration, function deploy,
model call, configuration activation, or learner write is part of this branch.
