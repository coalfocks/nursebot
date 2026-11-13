export const COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS = 1200;
export const MDM_EVALUATION_MAX_COMPLETION_TOKENS = 2200;
export const COMMENTARY_MAX_COMPLETION_TOKENS = 3000;

export const runIndependentFeedbackOperations = <Communication, Mdm, Commentary>(
  requestCommunicationEvaluation: () => Promise<Communication>,
  requestMdmEvaluation: () => Promise<Mdm>,
  requestCommentary: () => Promise<Commentary>,
): Promise<[Communication, Mdm, Commentary]> => Promise.all([
  requestCommunicationEvaluation(),
  requestMdmEvaluation(),
  requestCommentary(),
]);

type EvaluationSection = Record<string, unknown>;

const asSection = (value: unknown): EvaluationSection =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as EvaluationSection : {};

export const mergeEvaluationSections = (communicationValue: unknown, mdmValue: unknown): EvaluationSection => {
  const communication = asSection(communicationValue);
  const mdm = asSection(mdmValue);

  return {
    communication_breakdown: communication.communication_breakdown ?? communication.communication ?? {},
    clinical_reasoning_breakdown: mdm.clinical_reasoning_breakdown ?? mdm.mdm_breakdown ?? mdm.medical_decision_making ?? {},
    safety_result: mdm.safety_result,
    learning_objectives: mdm.learning_objectives,
    strengths: mdm.strengths,
    improvements: mdm.improvements,
    recommendations: mdm.recommendations,
    action_review: mdm.action_review ?? [],
  };
};
