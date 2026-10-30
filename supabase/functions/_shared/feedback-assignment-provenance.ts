import { ASSESSMENT_VERSION } from './feedback-contract';

type AssignmentMarProvenance = {
  case_key_version?: string | null;
};

/**
 * Assignment.case_key_version is the frozen MAR snapshot key. Feedback's
 * evaluated case key belongs in feedback_assessment_runs/debrief provenance;
 * it must never overwrite the assignment's MAR key during completion.
 */
export const withFrozenMarProvenance = <T extends Record<string, unknown>>(
  assignment: AssignmentMarProvenance,
  update: T,
): T & { case_key_version: string | null; assessment_version: string } => ({
  ...update,
  case_key_version: assignment.case_key_version ?? null,
  assessment_version: ASSESSMENT_VERSION,
});
