import {
  COMMENTARY_MAX_COMPLETION_TOKENS,
  COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS,
  MDM_EVALUATION_MAX_COMPLETION_TOKENS,
  mergeEvaluationSections,
  parseSectionCompletion,
  runIndependentFeedbackOperations,
} from './feedback-operations.ts';
import { canonicalizeEvaluation } from './evaluation-scoring.ts';

Deno.test('uses named completion budgets for the smaller evaluation sections and commentary', () => {
  if (COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS !== 4000) {
    throw new Error(`Unexpected communication completion budget: ${COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS}`);
  }
  if (MDM_EVALUATION_MAX_COMPLETION_TOKENS !== 6000) {
    throw new Error(`Unexpected MDM completion budget: ${MDM_EVALUATION_MAX_COMPLETION_TOKENS}`);
  }
  if (COMMENTARY_MAX_COMPLETION_TOKENS !== 3000) {
    throw new Error(`Unexpected commentary completion budget: ${COMMENTARY_MAX_COMPLETION_TOKENS}`);
  }
});

Deno.test('starts communication, MDM, and commentary before any operation completes', async () => {
  const started: string[] = [];
  const finishers: Array<(value: string) => void> = [];
  const request = (name: string) => () => {
    started.push(name);
    return new Promise<string>((resolve) => { finishers.push(resolve); });
  };

  const result = runIndependentFeedbackOperations(request('communication'), request('mdm'), request('commentary'));

  if (started.join(',') !== 'communication,mdm,commentary') {
    throw new Error(`Expected all operations to start, got: ${started.join(',')}`);
  }

  finishers[0]('communication result');
  finishers[1]('MDM result');
  finishers[2]('commentary result');
  const completed = await result;
  if (completed.join(',') !== 'communication result,MDM result,commentary result') {
    throw new Error(`Unexpected operation results: ${JSON.stringify(completed)}`);
  }
});

Deno.test('merges section responses deterministically and preserves nullable components and reasons', () => {
  const communication = {
    communication_breakdown: {
      focused_information_gathering: { score: 2, feedback: 'Focused assessment.', evidence_event_ids: ['student-1'], not_scored_reason: null },
      closed_loop_team_communication: { score: null, feedback: 'The communication capture is incomplete.', evidence_event_ids: [], not_scored_reason: 'Consultant message capture is missing.' },
      efficiency_deduction: { score: 0, feedback: 'No interference observed.', evidence_event_ids: [], not_scored_reason: null },
    },
  };
  const mdm = {
    clinical_reasoning_breakdown: {
      orders_monitoring_quality: { score: 3, feedback: 'Monitoring was appropriate.', evidence_event_ids: ['order-1'], not_scored_reason: null },
      clinical_reasoning_documentation: { score: null, feedback: 'The note source is unavailable.', evidence_event_ids: [], not_scored_reason: 'Progress note capture is missing.' },
      safety_deduction: { score: null, feedback: 'Safety cannot be assessed.', evidence_event_ids: [], not_scored_reason: 'Safety action source is missing.' },
    },
    safety_result: { level: 'not_assessed', action: null, rationale: 'Safety action source is missing.', evidence_event_ids: [] },
    learning_objectives: 'Review monitoring and documentation.',
    strengths: ['Appropriate monitoring.'],
    improvements: ['Document the rationale.'],
    recommendations: ['Reassess after intervention.'],
    action_review: [{ event_id: 'order-1' }],
  };

  const first = mergeEvaluationSections(communication, mdm);
  const second = mergeEvaluationSections(communication, mdm);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Section merge was not deterministic');
  if (first.learning_objectives !== mdm.learning_objectives || first.action_review !== mdm.action_review) {
    throw new Error('MDM narrative fields were not preserved');
  }

  const canonical = canonicalizeEvaluation(first as any);
  if (canonical.communication_breakdown.closed_loop_team_communication.score !== null
    || canonical.communication_breakdown.closed_loop_team_communication.not_scored_reason !== 'Consultant message capture is missing.'
    || canonical.mdm_breakdown.clinical_reasoning_documentation.score !== null
    || canonical.mdm_breakdown.clinical_reasoning_documentation.not_scored_reason !== 'Progress note capture is missing.'
    || canonical.mdm_breakdown.safety_deduction.score !== null
    || canonical.safety_result.level !== 'not_assessed'
    || canonical.learning_objectives !== mdm.learning_objectives
    || canonical.recommendations[0] !== mdm.recommendations[0]) {
    throw new Error(`Nullable section fields were not preserved: ${JSON.stringify(canonical)}`);
  }
});

Deno.test('missing sections merge to empty objects that canonicalization marks unscored', () => {
  const merged = mergeEvaluationSections(undefined, { recommendations: ['Review the case goals.'] });
  const canonical = canonicalizeEvaluation(merged as any);
  if (canonical.communication_breakdown.focused_information_gathering.score !== null
    || !canonical.communication_breakdown.focused_information_gathering.not_scored_reason
    || canonical.mdm_breakdown.orders_monitoring_quality.score !== null
    || canonical.safety_result.level !== 'not_assessed'
    || canonical.recommendations[0] !== 'Review the case goals.') {
    throw new Error(`Missing sections were not safely canonicalized: ${JSON.stringify(canonical)}`);
  }
});

Deno.test('section parser fails loudly on empty or truncated completions', () => {
  const completion = (content: string | null, finish_reason: string) => ({ choices: [{ finish_reason, message: { content } }] });
  if (parseSectionCompletion(completion('{"a":1}', 'stop')).a !== 1) throw new Error('valid JSON should parse');
  for (const [content, reason, pattern] of [['', 'length', /no content/], [null, 'stop', /no content/], ['{"a":', 'length', /truncated/]] as const) {
    try {
      parseSectionCompletion(completion(content, reason));
      throw new Error(`expected failure for ${reason}`);
    } catch (error) {
      if (!pattern.test(String(error instanceof Error ? error.message : error))) throw error;
    }
  }
});
