import type { EvaluationScoringResponse } from './evaluation-scoring.ts';

export const FEEDBACK_RUBRIC_VERSION = 'feedback-v3-2026-10-15';
export const CASE_KEY_VERSION = 'case-key-v2';
export const ASSESSMENT_VERSION = 'assessment-v2-2026-10-15';
export const CANONICAL_FEEDBACK_SCHEMA_VERSION = 'feedback-contract-v1';

export type CanonicalFeedbackComponent = {
  score: number;
  min: number;
  max: number;
  feedback: string;
  evidence_event_ids: string[];
};

export type CanonicalFeedbackEvidence = {
  id: string;
  kind: string;
  title: string;
  body: string;
  timestamp: string;
};

export type CanonicalFeedback = {
  schema_version: string;
  room_label: string;
  target_diagnosis: string | null;
  goals: string[];
  communication: {
    total: number;
    components: {
      focused_information_gathering: CanonicalFeedbackComponent;
      closed_loop_team_communication: CanonicalFeedbackComponent;
      efficiency_deduction: CanonicalFeedbackComponent;
    };
  };
  clinical_reasoning: {
    total: number;
    components: {
      orders_monitoring_quality: CanonicalFeedbackComponent;
      clinical_reasoning_documentation: CanonicalFeedbackComponent;
      safety_deduction: CanonicalFeedbackComponent;
    };
  };
  strengths: string[];
  next_steps: string[];
  evidence: CanonicalFeedbackEvidence[];
  scoring_start_at: string;
};

const isFiniteInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);

export const validateCanonicalFeedback = (value: CanonicalFeedback): CanonicalFeedback => {
  if (value.schema_version !== CANONICAL_FEEDBACK_SCHEMA_VERSION || !value.room_label.trim() || !value.scoring_start_at) throw new Error('Invalid canonical feedback identity');
  const validateDomain = (domain: CanonicalFeedback['communication'] | CanonicalFeedback['clinical_reasoning']) => {
    const components = Object.values(domain.components);
    if (components.length !== 3 || !isFiniteInteger(domain.total) || domain.total < 0 || domain.total > 5) throw new Error('Invalid canonical feedback domain');
    for (const component of components) {
      if (!isFiniteInteger(component.score) || component.score < component.min || component.score > component.max || !component.feedback.trim() || component.evidence_event_ids.some((id) => !id.trim())) throw new Error('Invalid canonical feedback component');
    }
    const raw = components.reduce((sum, component) => sum + component.score, 0);
    if (domain.total !== Math.max(0, Math.min(5, raw))) throw new Error('Canonical feedback arithmetic does not reconcile');
  };
  validateDomain(value.communication);
  validateDomain(value.clinical_reasoning);
  if (value.evidence.some((event) => !event.id.trim() || !event.kind.trim() || !event.title.trim() || !event.timestamp)) throw new Error('Invalid canonical feedback evidence');
  return value;
};

const canonicalComponent = (component: { score: number; feedback: string; evidence_event_ids?: string[] }, min: number, max: number): CanonicalFeedbackComponent => ({
  score: Math.max(min, Math.min(max, Math.round(component.score))),
  min,
  max,
  feedback: component.feedback,
  evidence_event_ids: component.evidence_event_ids ?? [],
});

export const buildCanonicalFeedback = ({
  roomLabel,
  targetDiagnosis,
  goals,
  evaluation,
  evidence,
  scoringStartAt,
}: {
  roomLabel: string;
  targetDiagnosis: string | null;
  goals: string[];
  evaluation: EvaluationScoringResponse;
  evidence: Array<{ id: string; kind: string; title: string; body?: string; timestamp: string }>;
  scoringStartAt: string;
}): CanonicalFeedback => {
  const communicationComponents = {
    focused_information_gathering: canonicalComponent(evaluation.communication_breakdown.focused_information_gathering, 0, 2),
    closed_loop_team_communication: canonicalComponent(evaluation.communication_breakdown.closed_loop_team_communication, 0, 3),
    efficiency_deduction: canonicalComponent(evaluation.communication_breakdown.efficiency_deduction, -2, 0),
  };
  const reasoningComponents = {
    orders_monitoring_quality: canonicalComponent(evaluation.clinical_reasoning_breakdown.orders_monitoring_quality, 0, 3),
    clinical_reasoning_documentation: canonicalComponent(evaluation.clinical_reasoning_breakdown.clinical_reasoning_documentation, 0, 2),
    safety_deduction: canonicalComponent(evaluation.clinical_reasoning_breakdown.safety_deduction, -2, 0),
  };
  return validateCanonicalFeedback({
    schema_version: CANONICAL_FEEDBACK_SCHEMA_VERSION,
    room_label: roomLabel,
    target_diagnosis: targetDiagnosis,
    goals: Array.from(new Set(goals)).slice(0, 5),
    communication: {
      total: Math.max(0, Math.min(5, communicationComponents.focused_information_gathering.score + communicationComponents.closed_loop_team_communication.score + communicationComponents.efficiency_deduction.score)),
      components: communicationComponents,
    },
    clinical_reasoning: {
      total: Math.max(0, Math.min(5, reasoningComponents.orders_monitoring_quality.score + reasoningComponents.clinical_reasoning_documentation.score + reasoningComponents.safety_deduction.score)),
      components: reasoningComponents,
    },
    strengths: evaluation.strengths.slice(0, 3),
    next_steps: [...evaluation.improvements, ...evaluation.recommendations].slice(0, 3),
    evidence: evidence.map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, body: entry.body ?? '', timestamp: entry.timestamp })),
    scoring_start_at: scoringStartAt,
  });
};

export type SafetyLevel = 'none' | 'concern' | 'critical';

export type SafetyResult = {
  level: SafetyLevel;
  action: string | null;
  rationale: string | null;
  evidence_event_ids: string[];
};

export type CaseEvaluationKey = {
  version: string;
  goals: string[];
  acuity_urgency_trigger: string | null;
  expected_endpoint: string | null;
  time_sensitive_actions: string[];
  must: string[];
  should: string[];
  could: string[];
  should_not: string[];
  must_not: string[];
  acceptable_alternative_paths: string[];
  decision_critical_questions_findings: string[];
  note_elements: string[];
  observed_channels: string[];
  safety_rationale: string | null;
};

const asStrings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  : [];

const goalInstruction = /reveal this goal only in post-case feedback|do not disclose the target diagnosis|do not reveal .*goal|review the evidence-linked strengths|you are evaluating|after the simulation, you should be able to|goals of (?:this )?case|target diagnosis\s*[—:-]/i;

const cleanGoal = (value: string): string => value
  .replace(/reveal this goal only in post-case feedback\.?/gi, '')
  .replace(/do not disclose the target diagnosis or goals through nurse or patient conversation before case completion\.?/gi, '')
  .replace(/review the evidence-linked strengths and next steps below\.?/gi, '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
  .trim();

const conciseGoal = (value: string): string | null => {
  const goal = cleanGoal(value);
  if (!goal || /^the case does not prescribe/i.test(goal)) return null;
  if (/^name the target diagnosis and connect it to/i.test(goal)) return 'Connect the diagnosis to the documented case evidence.';
  if (/^recognize time-critical deterioration and initiate/i.test(goal)) return 'Recognize time-critical deterioration and escalate appropriately.';
  if (/^select and document a focused evaluation and treatment plan/i.test(goal)) return 'Document a focused evaluation and treatment plan with reassessment.';
  if (/^give a concise, prioritized team update/i.test(goal)) return 'Use concise closed-loop team communication.';
  return goal.length <= 180 ? goal : null;
};

const asGoalStrings = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? asStrings(value) : typeof value === 'string' && value.trim()
    ? value.split(/\r?\n|(?=•)|(?=\u2022)/)
    : [];
  const goals: string[] = [];
  for (const item of raw) {
    const cleaned = cleanGoal(item.replace(/^\s*(?:[-*•]|Goals of Case)\s*/i, ''));
    if (!cleaned) continue;
    if (/^ROOM\s+[^—:]+(?:—|:)/i.test(cleaned) || (/^[A-Z0-9\s—:,-]+$/.test(cleaned) && cleaned.length > 12)) continue;
    // A generated prompt can contain a heading followed by a long prose block.
    // Keep only concise authored action statements, never the evaluator prompt.
    if (cleaned.length > 260) {
      const clauses = cleaned.split(/(?<=[.!?])\s+/).map(conciseGoal).filter((clause): clause is string => Boolean(clause) && !goalInstruction.test(clause));
      goals.push(...clauses.slice(0, 4));
      continue;
    }
    if (goalInstruction.test(cleaned)) continue;
    const concise = conciseGoal(cleaned);
    if (concise) goals.push(concise);
  }
  return Array.from(new Set(goals)).slice(0, 5);
};

const postCompletionGoals = (diagnosis: unknown, goals: string[]) => {
  const diagnosisText = typeof diagnosis === 'string' ? diagnosis.replace(/\s+/g, ' ').trim() : '';
  const conciseGoals = goals.map(cleanGoal).filter((goal) => goal && !goalInstruction.test(goal)).slice(0, 4);
  const joined = conciseGoals.join(' ');
  if (!diagnosisText || conciseGoals.length === 0 || /^do hard things$/i.test(joined)) return conciseGoals;
  if (/persistent pneumonia/i.test(diagnosisText) && /acute cholecystitis/i.test(joined)) return conciseGoals;
  return [`Recognize ${diagnosisText}.`, ...conciseGoals];
};

export const resolveCaseEvaluationKey = (room: Record<string, unknown>): CaseEvaluationKey => {
  let packageEvaluation: Record<string, unknown> = {};
  try {
    const parsed = typeof room.emr_context === 'string' ? JSON.parse(room.emr_context) : room.emr_context;
    packageEvaluation = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? ((parsed as Record<string, unknown>).evaluation as Record<string, unknown> ?? {})
      : {};
  } catch {
    packageEvaluation = {};
  }
  const source = { ...packageEvaluation };
  const authoredGoals = asGoalStrings(source.goals ?? room.case_goals).length
    ? asGoalStrings(source.goals ?? room.case_goals)
    : (typeof room.objective === 'string' && room.objective.trim() ? [room.objective.trim()] : []);
  return {
    version: typeof source.version === 'string' ? source.version : CASE_KEY_VERSION,
    goals: postCompletionGoals(room.expected_diagnosis, authoredGoals),
    acuity_urgency_trigger: typeof source.acuityUrgencyTrigger === 'string'
      ? source.acuityUrgencyTrigger : (typeof room.bedside_requirement === 'string' ? room.bedside_requirement : null),
    expected_endpoint: typeof source.expectedEndpoint === 'string' ? source.expectedEndpoint : null,
    time_sensitive_actions: asStrings(source.timeSensitiveActions),
    must: asStrings(source.must ?? source.criticalActions),
    should: asStrings(source.should),
    could: asStrings(source.could),
    should_not: asStrings(source.shouldNot),
    must_not: asStrings(source.mustNot ?? source.unsafeActions),
    acceptable_alternative_paths: asStrings(source.acceptableAlternativePaths),
    decision_critical_questions_findings: asStrings(source.decisionCriticalQuestionsFindings ?? source.expectedWorkup),
    note_elements: asStrings(source.noteElements),
    observed_channels: asStrings(source.observedChannels ?? ['bedside', 'patient', 'nurse_team', 'chart', 'orders_results', 'note']),
    safety_rationale: typeof source.safetyRationale === 'string' ? source.safetyRationale : null,
  };
};

export const deriveScoringStart = (messages: Array<{ id?: string | number | null; role: string; content: string; created_at: string | null }>) => {
  const firstPage = messages
    .filter((message) => message.role === 'assistant' || message.role === 'nurse')
    .filter((message) => message.content !== '<completed>' && message.created_at)
    .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())[0];
  return firstPage ? { scoring_start_at: new Date(firstPage.created_at!).toISOString(), event_id: String(firstPage.id ?? '') } : null;
};

export const isPostPageEvent = (timestamp: string, scoringStartAt: string | null) =>
  Boolean(scoringStartAt && new Date(timestamp).getTime() >= new Date(scoringStartAt).getTime());

export const normalizeEvidenceEventIds = (
  requested: unknown,
  available: string[],
): string[] => {
  const allowed = new Set(available);
  return Array.isArray(requested)
    ? requested.filter((id): id is string => typeof id === 'string' && allowed.has(id))
    : [];
};

export const formativeNotice = 'Formative feedback for learning only.';
