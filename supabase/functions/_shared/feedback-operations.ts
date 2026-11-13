export const EVALUATION_MAX_COMPLETION_TOKENS = 1800;
export const COMMENTARY_MAX_COMPLETION_TOKENS = 900;

export const runIndependentFeedbackOperations = <Evaluation, Commentary>(
  requestEvaluation: () => Promise<Evaluation>,
  requestCommentary: () => Promise<Commentary>,
): Promise<[Evaluation, Commentary]> => Promise.all([
  requestEvaluation(),
  requestCommentary(),
]);
