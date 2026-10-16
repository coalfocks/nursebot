export const CANONICAL_FEEDBACK_SCHEMA_VERSION = 'feedback-contract-v1';

export type FeedbackComponent = {
  score: number;
  min: number;
  max: number;
  feedback: string;
  evidence_event_ids: string[];
};

export type CanonicalFeedback = {
  schema_version: string;
  room_label: string;
  target_diagnosis: string | null;
  goals: string[];
  communication: {
    total: number;
    components: Record<'focused_information_gathering' | 'closed_loop_team_communication' | 'efficiency_deduction', FeedbackComponent>;
  };
  clinical_reasoning: {
    total: number;
    components: Record<'orders_monitoring_quality' | 'clinical_reasoning_documentation' | 'safety_deduction', FeedbackComponent>;
  };
  strengths: string[];
  next_steps: string[];
  evidence: Array<{ id: string; kind: string; title: string; body: string; timestamp: string }>;
  scoring_start_at: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const parseComponent = (value: unknown, expectedMin?: number, expectedMax?: number): FeedbackComponent | null => {
  if (!isRecord(value) || typeof value.score !== 'number' || !Number.isInteger(value.score) || typeof value.min !== 'number' || typeof value.max !== 'number' || !Number.isFinite(value.min) || !Number.isFinite(value.max) || typeof value.feedback !== 'string' || !value.feedback.trim() || !isStringArray(value.evidence_event_ids) || value.evidence_event_ids.some((id) => !id.trim())) return null;
  if (value.score < value.min || value.score > value.max || value.min > value.max || (expectedMin !== undefined && value.min !== expectedMin) || (expectedMax !== undefined && value.max !== expectedMax)) return null;
  return { score: value.score, min: value.min, max: value.max, feedback: value.feedback, evidence_event_ids: value.evidence_event_ids };
};

const parseComponents = <T extends string>(value: unknown, names: readonly T[], ranges: Record<T, [number, number]>): Record<T, FeedbackComponent> | null => {
  if (!isRecord(value)) return null;
  const parsed = {} as Record<T, FeedbackComponent>;
  for (const name of names) {
    const component = parseComponent(value[name], ranges[name][0], ranges[name][1]);
    if (!component) return null;
    parsed[name] = component;
  }
  return parsed;
};

const reconciledTotal = (components: Record<string, FeedbackComponent>) => {
  const raw = Object.values(components).reduce((sum, component) => sum + component.score, 0);
  return Math.max(0, Math.min(5, raw));
};

export const parseCanonicalFeedback = (value: unknown): CanonicalFeedback | null => {
  if (!isRecord(value) || value.schema_version !== CANONICAL_FEEDBACK_SCHEMA_VERSION || typeof value.room_label !== 'string' || !value.room_label.trim() || (value.target_diagnosis !== null && typeof value.target_diagnosis !== 'string') || !isStringArray(value.goals) || !isStringArray(value.strengths) || !isStringArray(value.next_steps) || typeof value.scoring_start_at !== 'string' || !value.scoring_start_at || !Array.isArray(value.evidence)) return null;
  const communicationComponents = parseComponents(value.communication && isRecord(value.communication) ? value.communication.components : null, ['focused_information_gathering', 'closed_loop_team_communication', 'efficiency_deduction'] as const, { focused_information_gathering: [0, 2], closed_loop_team_communication: [0, 3], efficiency_deduction: [-2, 0] });
  const reasoningComponents = parseComponents(value.clinical_reasoning && isRecord(value.clinical_reasoning) ? value.clinical_reasoning.components : null, ['orders_monitoring_quality', 'clinical_reasoning_documentation', 'safety_deduction'] as const, { orders_monitoring_quality: [0, 3], clinical_reasoning_documentation: [0, 2], safety_deduction: [-2, 0] });
  if (!communicationComponents || !reasoningComponents || !isRecord(value.communication) || !isRecord(value.clinical_reasoning) || typeof value.communication.total !== 'number' || !Number.isInteger(value.communication.total) || typeof value.clinical_reasoning.total !== 'number' || !Number.isInteger(value.clinical_reasoning.total) || value.communication.total !== reconciledTotal(communicationComponents) || value.clinical_reasoning.total !== reconciledTotal(reasoningComponents)) return null;
  const evidence = value.evidence.filter((entry): entry is Record<string, unknown> => isRecord(entry)).map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, body: entry.body, timestamp: entry.timestamp }));
  if (evidence.length !== value.evidence.length || evidence.some((entry) => typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.kind !== 'string' || !entry.kind.trim() || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.body !== 'string' || typeof entry.timestamp !== 'string' || !entry.timestamp)) return null;
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  if ([...Object.values(communicationComponents ?? {}), ...Object.values(reasoningComponents ?? {})].some((component) => component.evidence_event_ids.some((id) => !evidenceIds.has(id)))) return null;
  return {
    schema_version: value.schema_version,
    room_label: value.room_label,
    target_diagnosis: value.target_diagnosis,
    goals: value.goals,
    communication: { total: value.communication.total as number, components: communicationComponents },
    clinical_reasoning: { total: value.clinical_reasoning.total as number, components: reasoningComponents },
    strengths: value.strengths,
    next_steps: value.next_steps,
    evidence,
    scoring_start_at: value.scoring_start_at,
  };
};

export const feedbackDomainArithmetic = (components: Record<string, FeedbackComponent>) => {
  const raw = Object.values(components).reduce((sum, component) => sum + component.score, 0);
  return { raw, total: Math.max(0, Math.min(5, raw)) };
};
