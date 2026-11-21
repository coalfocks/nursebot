// Reasoning models spend part of max_completion_tokens on hidden reasoning.
// PR #35/#36 budgets (1200/2200) left no room for visible JSON, so the
// response came back empty with finish_reason=length.
export const COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS = 4000;
export const MDM_EVALUATION_MAX_COMPLETION_TOKENS = 6000;
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

type CompletionLike = { choices: Array<{ finish_reason?: string | null; message: { content?: string | null } }> };

/** Parse a section completion, failing loudly on empty or truncated output instead of "Unexpected end of JSON input". */
export const parseSectionCompletion = (completion: CompletionLike): Record<string, unknown> => {
  const choice = completion.choices[0];
  const content = choice?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error(`Model returned no content (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
  }
  if (choice?.finish_reason === 'length') {
    throw new Error('Model response was truncated (finish_reason=length)');
  }
  return JSON.parse(content) as Record<string, unknown>;
};

/** A missing/invalid response is a technical failure, not evidence-based abstention. */
export const assertCompleteEvaluation = (evaluation: {
  communication_breakdown: Record<string, { score: number | null; not_scored_reason?: string | null }>;
  clinical_reasoning_breakdown: Record<string, { score: number | null; not_scored_reason?: string | null }>;
}, sectionErrors: Record<string, string> = {}): void => {
  const errors = Object.entries(sectionErrors).map(([section, error]) => `${section}: ${error}`);
  for (const [section, components] of Object.entries({ communication: evaluation.communication_breakdown, medical_decision_making: evaluation.clinical_reasoning_breakdown })) {
    if (Object.keys(components).length !== 3) errors.push(`${section}: incomplete component response`);
    for (const [name, component] of Object.entries(components)) {
      if (component.score == null && (!component.not_scored_reason || /^Not scored: (required |component value )/.test(component.not_scored_reason))) {
        errors.push(`${section}.${name}: missing or invalid component response`);
      }
    }
  }
  if (errors.length) throw new Error(`Evaluation response incomplete; prior saved result was kept (${errors.join('; ')})`);
};

/** Retry only a truncated/empty length-limited response, once, with identical messages. */
export const requestSectionWithLengthRetry = async <T>(request: (budget: number) => Promise<T>, budget: number, ceiling = budget * 2): Promise<T> => {
  try { return await request(budget); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('finish_reason=length') || budget >= ceiling) throw error;
    return await request(Math.min(budget * 2, ceiling));
  }
};

/** Commentary uses the same single doubled-budget recovery, only on an explicit length finish. */
export const requestCompletionWithLengthRetry = <T extends CompletionLike>(request: (budget: number) => Promise<T>, budget: number): Promise<T> =>
  requestSectionWithLengthRetry(async (currentBudget) => {
    const completion = await request(currentBudget);
    if (completion.choices[0]?.finish_reason === 'length') {
      throw new Error('Model response was truncated (finish_reason=length)');
    }
    return completion;
  }, budget);
