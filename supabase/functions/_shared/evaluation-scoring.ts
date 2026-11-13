export type ScoredComponent = { score: number | null; feedback: string; evidence_event_ids: string[]; not_scored_reason?: string | null };

export interface EvaluationScoringResponse {
  learning_objectives: string;
  communication_score: number | null;
  mdm_score: number | null;
  clinical_reasoning_score: number | null;
  communication_breakdown: {
    focused_information_gathering: ScoredComponent;
    closed_loop_team_communication: ScoredComponent;
    efficiency_deduction: ScoredComponent;
  };
  mdm_breakdown: {
    orders_monitoring_quality: ScoredComponent;
    clinical_reasoning_documentation: ScoredComponent;
    safety_deduction: ScoredComponent;
  };
  clinical_reasoning_breakdown: EvaluationScoringResponse['mdm_breakdown'];
  safety_result: { level: 'none' | 'concern' | 'critical' | 'not_assessed'; action: string | null; rationale: string | null; evidence_event_ids: string[] };
  strengths: string[];
  improvements: string[];
  recommendations: string[];
}

const validScore = (value: unknown, min: number, max: number): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
};
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

export const sanitizeSimulationText = (value: string): string => value
  .replace(/\bphysical examination\b/gi, 'simulated bedside interaction')
  .replace(/\bphysical exam\b/gi, 'simulated bedside interaction')
  .replace(/\bexamined the patient\b/gi, 'assessed the patient in the simulation')
  .replace(/\bexamined\b/gi, 'assessed in the simulation')
  .replace(/\bphysical findings?\b/gi, 'recorded simulated bedside findings')
  .replace(/documented specific bedside signs/gi, (match) => match[0] === match[0].toUpperCase() ? 'Recorded learner-reported simulated bedside findings' : 'recorded learner-reported simulated bedside findings')
  .replace(/structured bedside action/gi, 'learner-recorded simulated bedside/team action')
  .replace(/bedside signs of impaired perfusion and ongoing dizziness/gi, 'learner-recorded perfusion concern and dizziness');

const parseComponent = (component: any, min: number, max: number, label: string): ScoredComponent => {
  const rawScore = typeof component === 'number' || typeof component === 'string'
    ? component : component?.score ?? component?.value ?? component?.points;
  const score = validScore(rawScore, min, max);
  const suppliedReason = typeof component?.not_scored_reason === 'string' && component.not_scored_reason.trim()
    ? component.not_scored_reason.trim() : null;
  const reason = score == null ? suppliedReason ?? (rawScore == null
    ? `Not scored: required ${label} evidence or component response is missing.`
    : `Not scored: component value is outside the allowed ${min} to ${max} range or is invalid.`) : null;
  return {
    score,
    feedback: sanitizeSimulationText(text(component?.feedback, reason ?? `Observed ${label} evidence supports a score of ${score}.`)),
    evidence_event_ids: ids(component?.evidence_event_ids),
    not_scored_reason: reason,
  };
};

export const canonicalizeEvaluation = (raw: Partial<EvaluationScoringResponse>): EvaluationScoringResponse => {
  const source = raw as Record<string, any>;
  const communication = (source.communication_breakdown ?? source.communication ?? {}) as Record<string, any>;
  const mdm = (source.clinical_reasoning_breakdown ?? source.mdm_breakdown ?? source.medical_decision_making ?? source.mdm ?? {}) as Record<string, any>;
  const focusedRaw = communication.focused_information_gathering ?? communication.information_gathering ?? communication.information_sharing ?? communication.focused_gathering;
  const closedLoopRaw = communication.closed_loop_team_communication ?? communication.closed_loop_communication ?? communication.responsive_communication ?? communication.team_communication;
  const efficiencyRaw = communication.efficiency_deduction ?? communication.efficiency;
  const ordersRaw = mdm.orders_monitoring_quality ?? mdm.orders_monitoring ?? mdm.labs_orders_quality ?? mdm.orders_quality;
  const reasoningRaw = mdm.clinical_reasoning_documentation ?? mdm.reasoning_documentation ?? mdm.note_thought_process ?? mdm.reasoning;
  const safetyDeductionRaw = mdm.safety_deduction ?? mdm.safety;
  const communicationBreakdown = {
    focused_information_gathering: parseComponent(focusedRaw, 0, 2, 'focused information gathering'),
    closed_loop_team_communication: parseComponent(closedLoopRaw, 0, 3, 'responsive/closed-loop communication'),
    efficiency_deduction: parseComponent(efficiencyRaw, -2, 0, 'efficiency deduction'),
  };
  const safetyRawResult = source.safety_result;
  const safetyLevelIsKnown = ['none', 'concern', 'critical'].includes(safetyRawResult?.level)
    && validScore(typeof safetyDeductionRaw === 'object' ? safetyDeductionRaw?.score : safetyDeductionRaw, -2, 0) != null;
  const clinicalReasoningBreakdown = {
    orders_monitoring_quality: parseComponent(ordersRaw, 0, 3, 'orders and monitoring quality'),
    clinical_reasoning_documentation: parseComponent(reasoningRaw, 0, 2, 'clinical reasoning and documentation'),
    safety_deduction: safetyLevelIsKnown
      ? parseComponent(safetyDeductionRaw, -2, 0, 'safety deduction')
      : parseComponent(undefined, -2, 0, 'safety deduction; safety review result is missing'),
  };
  const communicationParts = Object.values(communicationBreakdown);
  const mdmParts = Object.values(clinicalReasoningBreakdown);
  const communicationScore = communicationParts.every((part) => part.score != null)
    ? Math.max(0, Math.min(5, communicationParts.reduce((sum, part) => sum + part.score!, 0))) : null;
  const mdmScore = mdmParts.every((part) => part.score != null)
    ? Math.max(0, Math.min(5, mdmParts.reduce((sum, part) => sum + part.score!, 0))) : null;
  const rawSafety = safetyRawResult;
  const safetyLevel = safetyLevelIsKnown && (rawSafety?.level === 'critical' || rawSafety?.level === 'concern' || rawSafety?.level === 'none')
    ? rawSafety.level : 'not_assessed';
  const safetyResult = {
    level: safetyLevel as EvaluationScoringResponse['safety_result']['level'],
    action: typeof rawSafety?.action === 'string' ? sanitizeSimulationText(rawSafety.action) : null,
    rationale: typeof rawSafety?.rationale === 'string' ? sanitizeSimulationText(rawSafety.rationale) : null,
    evidence_event_ids: ids(rawSafety?.evidence_event_ids),
  };
  return {
    learning_objectives: sanitizeSimulationText(text(raw.learning_objectives, 'Review the evidence-linked strengths and next steps below.')),
    communication_score: communicationScore,
    mdm_score: mdmScore,
    clinical_reasoning_score: mdmScore,
    communication_breakdown: communicationBreakdown,
    mdm_breakdown: clinicalReasoningBreakdown,
    clinical_reasoning_breakdown: clinicalReasoningBreakdown,
    safety_result: safetyResult,
    strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText).slice(0, 2) : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText) : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText) : [],
  };
};

export const hasMeaningfulEvidence = (sourceEventIds: string[]) => sourceEventIds.length > 0;

export const isLearnerAuthoredEvidence = (entry: { actor_role?: string | null }) =>
  ['student', 'user', 'learner'].includes((entry.actor_role ?? '').toLowerCase());
