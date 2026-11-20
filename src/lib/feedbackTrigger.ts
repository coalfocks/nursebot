import { supabase } from './supabase';
import { readFunctionErrorMessage } from './feedbackService';

/**
 * Scoped "feedback on Complete" trigger. It only ever asks the server to generate feedback for ONE assignment.
 * The edge function claims the assignment atomically (pending -> processing), so calling this repeatedly
 * (double click, reload, resume on page load) starts the evaluator at most once, and it returns immediately
 * while generation continues on the server.
 */
export type FeedbackUiState = 'none' | 'pending' | 'done' | 'failed';

export const feedbackUiState = (assignment: { status?: string | null; feedback_status?: string | null } | null | undefined): FeedbackUiState => {
  if (!assignment || assignment.status !== 'completed') return 'none';
  switch (assignment.feedback_status) {
    case 'completed': return 'done';
    case 'failed': return 'failed';
    default: return 'pending'; // pending | processing
  }
};

/** True when a completed assignment is waiting on feedback and the page should (re)request it. */
export const shouldResumeFeedback = (assignment: { status?: string | null; feedback_status?: string | null } | null | undefined): boolean =>
  feedbackUiState(assignment) === 'pending';

export type AutoFeedbackResult = { accepted: boolean; skipped?: string };

export async function requestAutoFeedback(assignmentId: string): Promise<AutoFeedbackResult> {
  const { data, error } = await supabase.functions.invoke('generate-feedback', { body: { assignmentId, mode: 'auto' } });
  if (error) throw new Error(await readFunctionErrorMessage(error));
  return { accepted: data?.accepted === true, skipped: typeof data?.skipped === 'string' ? data.skipped : undefined };
}

/** Retry after a failure: re-queue only this assignment's failed feedback, then request it again. */
export async function retryFailedFeedback(assignmentId: string): Promise<AutoFeedbackResult> {
  const { error } = await supabase
    .from('student_room_assignments')
    .update({ feedback_status: 'pending', feedback_error: null })
    .eq('id', assignmentId)
    .eq('status', 'completed')
    .eq('feedback_status', 'failed');
  if (error) throw error;
  return requestAutoFeedback(assignmentId);
}
