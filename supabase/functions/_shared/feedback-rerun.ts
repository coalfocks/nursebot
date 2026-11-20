// Pure helpers for compare-only feedback reruns and the explicit promote action.
import { scoredAssignmentUpdate } from './feedback-assignment-update.ts';

export const PROMOTE_CONFIRMATION = 'PROMOTE';

type Json = Record<string, any>;

/** Everything on the assignment row that a promotion replaces, so it can be restored. */
export const PROMOTION_FIELDS = [
  'feedback_status', 'feedback_error', 'communication_score', 'mdm_score', 'communication_breakdown', 'mdm_breakdown',
  'learning_objectives', 'grade', 'nurse_feedback', 'feedback_generated_at', 'scoring_start_at', 'rubric_version',
  'case_key_version', 'assessment_version', 'source_event_ids', 'technical_incomplete', 'safety_result', 'feedback_debrief',
] as const;

export const snapshotOfficialResult = (assignment: Json): Json => Object.fromEntries(PROMOTION_FIELDS.map((field) => [field, assignment[field] ?? null]));

export type PromoteCheck = { ok: true } | { ok: false; code: string; message: string };

export const checkPromotable = (version: Json | null, assignmentId: string, confirmation: unknown): PromoteCheck => {
  if (confirmation !== PROMOTE_CONFIRMATION) return { ok: false, code: 'CONFIRMATION_REQUIRED', message: `Type ${PROMOTE_CONFIRMATION} to confirm promotion` };
  if (!version || version.assignment_id !== assignmentId) return { ok: false, code: 'VERSION_NOT_FOUND', message: 'Rerun version not found for this assignment' };
  if (version.status !== 'completed' || !version.result) return { ok: false, code: 'NOT_COMPLETED', message: 'Only a completed rerun can be promoted' };
  if (version.promoted_at) return { ok: false, code: 'ALREADY_PROMOTED', message: 'This rerun was already promoted' };
  return { ok: true };
};

/** Builds the assignment update from a stored rerun, using the same writer as a normal graded run. */
export const assignmentUpdateFromVersion = (version: Json): Json => {
  const result = version.result as Json;
  if (version.technical_incomplete) {
    return { feedback_status: 'completed', feedback_error: null, scoring_start_at: null, source_event_ids: [], technical_incomplete: true, safety_result: null, feedback_debrief: result.debrief ?? result, nurse_feedback: result.debrief ?? result, communication_score: null, mdm_score: null, grade: null, feedback_generated_at: new Date().toISOString() };
  }
  const debrief = { ...(result.debrief as Json), promoted_from_rerun_version_id: version.id, promoted_at: new Date().toISOString() };
  return scoredAssignmentUpdate(result.evaluation, debrief, { version: result.case_key_version ?? '' }, result.scoring_start_at, result.source_event_ids ?? []);
};
