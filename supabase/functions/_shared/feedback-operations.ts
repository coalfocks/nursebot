export const runIndependentFeedbackOperations = <Evaluation, Commentary>(
  requestEvaluation: () => Promise<Evaluation>,
  requestCommentary: () => Promise<Commentary>,
): Promise<[Evaluation, Commentary]> => Promise.all([
  requestEvaluation(),
  requestCommentary(),
]);
