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

type CoverageEntry = { kind: string };

const COVERAGE_SOURCES: Array<{ label: string; kinds: string[] }> = [
  { label: 'nurse and learner chat', kinds: ['message'] },
  { label: 'consultant requests and messages', kinds: ['consultant-message'] },
  { label: 'medical orders', kinds: ['order'] },
  { label: 'lab results', kinds: ['labs'] },
  { label: 'vital signs', kinds: ['vital'] },
  { label: 'imaging studies', kinds: ['imaging'] },
  { label: 'learner actions', kinds: ['learner-action'] },
  { label: 'progress note', kinds: ['progress-note'] },
];

/**
 * States, per source, that the event manifest was queried and how many records
 * it returned. A queried source with zero records is complete (no such events
 * occurred), so the grader must not treat it as missing capture.
 */
export const buildSourceCoverageSummary = (entries: CoverageEntry[]): string =>
  COVERAGE_SOURCES.map(({ label, kinds }) => {
    const count = entries.filter((entry) => kinds.includes(entry.kind)).length;
    return `- ${label}: queried successfully, ${count} record${count === 1 ? '' : 's'}${count === 0 ? ' (complete; none in scoring window)' : ''}`;
  }).join('\n');
