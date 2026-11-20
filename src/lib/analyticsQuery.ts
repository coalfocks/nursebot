// Analytics read query helpers. Kept separate from the page so the pre-migration fallback and the
// load-error text can be tested without rendering.

const COLUMNS_BEFORE_CASE_START = `
          id, school_id, is_sandbox, student_id, room_id, status, feedback_status, communication_score, mdm_score,
          grade, created_at, scoring_start_at,`;
const COLUMNS_AFTER_CASE_START = ` safety_result, completed_at, feedback_generated_at, case_difficulty,
          communication_breakdown, mdm_breakdown, nurse_feedback, feedback_debrief,
          student:student_id (id, full_name, role),
          room:room_id (id, room_number, specialty_id, specialty_ids),
          school:school_id (id, name)
        `;

/** Select list for student_room_assignments. `withCaseStart: false` is the pre-migration form (no case_started_at). */
export const buildAnalyticsSelect = (withCaseStart: boolean): string =>
  `${COLUMNS_BEFORE_CASE_START}${withCaseStart ? ' case_started_at,' : ''}${COLUMNS_AFTER_CASE_START}`;

export const CASE_START_UNAVAILABLE_NOTICE =
  'Case Start timing is unavailable: this database has not been migrated to record Case Start (column case_started_at is missing). Timestamps are never estimated; all other analytics are unaffected.';

type ErrorLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
const asErrorLike = (error: unknown): ErrorLike | null => (error && typeof error === 'object' ? error as ErrorLike : null);

/** True only for "column ... case_started_at does not exist" (Postgres 42703 via PostgREST). Other failures are not swallowed. */
export const isMissingCaseStartColumn = (error: unknown): boolean => {
  const info = asErrorLike(error);
  if (!info) return false;
  const message = typeof info.message === 'string' ? info.message : '';
  return /case_started_at/.test(message) && (info.code === '42703' || /does not exist/i.test(message));
};

/**
 * Message shown when analytics cannot load. PostgREST errors are plain objects, not Error instances, so reading only
 * `err instanceof Error` hid the real cause behind a generic sentence.
 */
export const describeAnalyticsLoadError = (error: unknown): string => {
  const info = asErrorLike(error);
  const message = info && typeof info.message === 'string' ? info.message.trim() : '';
  if (!message) return 'Analytics could not be loaded (no error detail was returned).';
  const code = info && typeof info.code === 'string' && info.code ? ` [${info.code}]` : '';
  const hint = info && typeof info.hint === 'string' && info.hint.trim() ? ` Hint: ${info.hint.trim()}` : '';
  return `Analytics could not be loaded: ${message}${code}.${hint}`.replace(/\.\.$/, '.');
};
