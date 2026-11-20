import { canonicalizeEvaluation } from './evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION } from './feedback-contract.ts';

// Single writer for a scored result, shared by fresh grading and saved-score reuse.
// Comments-only reruns never call this, so their scores and safety are untouched.
export const scoredAssignmentUpdate = (
  evaluation: ReturnType<typeof canonicalizeEvaluation>,
  debrief: Record<string, unknown>,
  key: { version: string },
  scoringStartAt: string,
  sourceEventIds: string[],
) => {
  const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
  return {
    feedback_status: 'completed',
    feedback_error: null,
    communication_score: evaluation.communication_score,
    mdm_score: evaluation.clinical_reasoning_score,
    communication_breakdown: evaluation.communication_breakdown,
    mdm_breakdown: evaluation.clinical_reasoning_breakdown,
    learning_objectives: evaluation.learning_objectives,
    grade: null,
    nurse_feedback: legacy,
    feedback_generated_at: new Date().toISOString(),
    scoring_start_at: scoringStartAt,
    rubric_version: FEEDBACK_RUBRIC_VERSION,
    case_key_version: key.version || CASE_KEY_VERSION,
    assessment_version: ASSESSMENT_VERSION,
    source_event_ids: sourceEventIds,
    technical_incomplete: false,
    safety_result: evaluation.safety_result,
    feedback_debrief: debrief,
  };
};

