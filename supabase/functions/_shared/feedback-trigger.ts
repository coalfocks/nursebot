// Scoped, idempotent "feedback on Complete" trigger for generate-feedback (mode: 'auto').
// The claim is one conditional UPDATE, so concurrent or repeated calls for the same assignment run the
// evaluator at most once, and it can only ever touch the one assignment ID it was given.

export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export type ClaimOutcome = 'claimed' | 'not_completed' | 'already_done' | 'in_flight' | 'failed_needs_retry' | 'not_found';

type ClaimRow = { id: string; status: string | null; feedback_status: string | null };
type ClaimClient = {
  from: (table: string) => any; // supabase-js query builder
};

/** Pure classification used for the skip reason and the UI state. */
export const classifyClaim = (row: { status?: string | null; feedback_status?: string | null; updated_at?: string | null } | null, now = Date.now()): ClaimOutcome => {
  if (!row) return 'not_found';
  if (row.status !== 'completed') return 'not_completed';
  if (row.feedback_status === 'pending') return 'claimed';
  if (row.feedback_status === 'processing') {
    const updated = row.updated_at ? Date.parse(row.updated_at) : NaN;
    return Number.isFinite(updated) && now - updated < STALE_PROCESSING_MS ? 'in_flight' : 'claimed';
  }
  if (row.feedback_status === 'failed') return 'failed_needs_retry';
  return 'already_done';
};

/**
 * Atomically moves pending (or stale processing) -> processing for a completed assignment.
 * Returns 'claimed' only when this call won the claim; otherwise explains why it did not.
 * It never writes to any other assignment and never touches saved grades or feedback.
 */
export const claimAssignmentFeedback = async (client: ClaimClient, assignmentId: string, now = Date.now()): Promise<ClaimOutcome> => {
  const staleBefore = new Date(now - STALE_PROCESSING_MS).toISOString();
  const { data, error } = await client
    .from('student_room_assignments')
    .update({ feedback_status: 'processing', feedback_error: null })
    .eq('id', assignmentId)
    .eq('status', 'completed')
    .or(`feedback_status.eq.pending,and(feedback_status.eq.processing,updated_at.lt.${staleBefore})`)
    .select('id, status, feedback_status');
  if (error) throw error;
  if ((data as ClaimRow[] | null)?.length === 1) return 'claimed';
  const { data: current, error: readError } = await client
    .from('student_room_assignments').select('status, feedback_status, updated_at').eq('id', assignmentId).maybeSingle();
  if (readError) throw readError;
  const outcome = classifyClaim(current, now);
  // Lost the race, or the row was not claimable: never report 'claimed' without owning the update.
  return outcome === 'claimed' ? 'in_flight' : outcome;
};
