export interface EvaluationScoringResponse {
  learning_objectives: string;
  communication_score: number;
  mdm_score: number;
  clinical_reasoning_score: number;
  communication_breakdown: {
    focused_information_gathering: { score: number; feedback: string; evidence_event_ids?: string[] };
    closed_loop_team_communication: { score: number; feedback: string; evidence_event_ids?: string[] };
    efficiency_deduction: { score: number; feedback: string; evidence_event_ids?: string[] };
  };
  mdm_breakdown: {
    orders_monitoring_quality: { score: number; feedback: string; evidence_event_ids?: string[] };
    clinical_reasoning_documentation: { score: number; feedback: string; evidence_event_ids?: string[] };
    safety_deduction: { score: number; feedback: string; evidence_event_ids?: string[] };
  };
  clinical_reasoning_breakdown: EvaluationScoringResponse['mdm_breakdown'];
  safety_result: { level: 'none' | 'concern' | 'critical'; action: string | null; rationale: string | null; evidence_event_ids: string[] };
  strengths: string[];
  improvements: string[];
  recommendations: string[];
};

const clamp = (value: unknown, min: number, max: number) => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? Math.round(numeric) : min));
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

export const canonicalizeEvaluation = (raw: Partial<EvaluationScoringResponse>): EvaluationScoringResponse => {
  const source = raw as Record<string, any>;
  const communication = (source.communication_breakdown ?? source.communication ?? {}) as Record<string, any>;
  const mdm = (source.mdm_breakdown ?? source.clinical_reasoning_breakdown ?? source.medical_decision_making ?? source.mdm ?? {}) as Record<string, any>;
  const focusedRaw = communication.focused_information_gathering ?? communication.information_gathering ?? communication.information_sharing ?? communication.focused_gathering;
  const closedLoopRaw = communication.closed_loop_team_communication ?? communication.closed_loop_communication ?? communication.responsive_communication ?? communication.team_communication;
  const efficiencyRaw = communication.efficiency_deduction ?? communication.efficiency ?? {};
  const ordersRaw = mdm.orders_monitoring_quality ?? mdm.orders_monitoring ?? mdm.labs_orders_quality ?? mdm.orders_quality;
  const reasoningRaw = mdm.clinical_reasoning_documentation ?? mdm.reasoning_documentation ?? mdm.note_thought_process ?? mdm.reasoning;
  const safetyDeductionRaw = mdm.safety_deduction ?? mdm.safety ?? {};
  const componentScore = (component: Record<string, any> | undefined) => component?.score ?? component?.value ?? component?.points ?? 0;
  const focused = clamp(componentScore(focusedRaw), 0, 2);
  const closedLoop = clamp(componentScore(closedLoopRaw), 0, 3);
  const efficiency = clamp(componentScore(efficiencyRaw), -2, 0);
  const orders = clamp(componentScore(ordersRaw), 0, 3);
  const reasoning = clamp(componentScore(reasoningRaw), 0, 2);
  const safetyDeduction = clamp(componentScore(safetyDeductionRaw), -2, 0);
  const safety = raw.safety_result?.level === 'critical' || raw.safety_result?.level === 'concern' ? raw.safety_result.level : 'none';
  const communicationBreakdown = {
    focused_information_gathering: { score: focused, feedback: sanitizeSimulationText(text(focusedRaw?.feedback, 'Insufficient evidence to assess focused information gathering.')), evidence_event_ids: ids(focusedRaw?.evidence_event_ids) },
    closed_loop_team_communication: { score: closedLoop, feedback: sanitizeSimulationText(text(closedLoopRaw?.feedback, 'Insufficient evidence to assess closed-loop team communication.')), evidence_event_ids: ids(closedLoopRaw?.evidence_event_ids) },
    efficiency_deduction: { score: efficiency, feedback: sanitizeSimulationText(text(efficiencyRaw?.feedback, 'No case-specific efficiency deduction; message count and timing are not scored.')), evidence_event_ids: ids(efficiencyRaw?.evidence_event_ids) },
  };
  const clinicalReasoningBreakdown = {
    orders_monitoring_quality: { score: orders, feedback: sanitizeSimulationText(text(ordersRaw?.feedback, 'Insufficient evidence to assess orders and monitoring.')), evidence_event_ids: ids(ordersRaw?.evidence_event_ids) },
    clinical_reasoning_documentation: { score: reasoning, feedback: sanitizeSimulationText(text(reasoningRaw?.feedback, 'Insufficient evidence to assess clinical reasoning and documentation.')), evidence_event_ids: ids(reasoningRaw?.evidence_event_ids) },
    safety_deduction: { score: safetyDeduction, feedback: sanitizeSimulationText(text(safetyDeductionRaw?.feedback, 'No actual unsafe learner action/order requiring a deduction was observed.')), evidence_event_ids: ids(safetyDeductionRaw?.evidence_event_ids) },
  };
  const clinicalReasoningScore = Math.max(0, Math.min(5, orders + reasoning + safetyDeduction));
  return {
    learning_objectives: sanitizeSimulationText(text(raw.learning_objectives, 'Review the evidence-linked strengths and next steps below.')),
    communication_score: Math.max(0, Math.min(5, focused + closedLoop + efficiency)),
    mdm_score: clinicalReasoningScore,
    clinical_reasoning_score: clinicalReasoningScore,
    communication_breakdown: communicationBreakdown,
    mdm_breakdown: clinicalReasoningBreakdown,
    clinical_reasoning_breakdown: clinicalReasoningBreakdown,
    safety_result: { level: safety, action: raw.safety_result?.action ?? null, rationale: raw.safety_result?.rationale ?? null, evidence_event_ids: ids(raw.safety_result?.evidence_event_ids) },
    strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText).slice(0, 3) : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText).slice(0, 3) : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.filter((v): v is string => typeof v === 'string').map(sanitizeSimulationText) : [],
  };
};

export const hasMeaningfulEvidence = (sourceEventIds: string[]) => sourceEventIds.length > 0;
type EvidenceShape = { kind: string; title: string; body?: string; meta?: string[] };
const learnerActionKinds = new Set(['learner-action']);
const learnerCommunicationKinds = new Set(['learner-action']);

export const buildEvidenceBackedFallback = (evaluation: EvaluationScoringResponse, entries: EvidenceShape[], progressNote: string | null | undefined): EvaluationScoringResponse | null => {
  if (evaluation.communication_score !== 0 || evaluation.clinical_reasoning_score !== 0) return evaluation;
  const learnerMessages = entries.filter((entry) =>
    (entry.kind === 'message' && entry.title === 'Student message')
      || (['patient-message', 'consultant-message'].includes(entry.kind) && entry.meta?.some((value) => value === 'Author: Student')),
  );
  const clinicalActions = entries.filter((entry) => learnerActionKinds.has(entry.kind));
  const orders = entries.filter((entry) => entry.kind === 'order' || entry.kind === 'labs' || entry.kind === 'imaging');
  const hasNote = Boolean(progressNote?.trim());
  if (learnerMessages.length === 0 && clinicalActions.length === 0 && orders.length === 0 && !hasNote) return null;
  const communicationActions = entries.filter((entry) => learnerCommunicationKinds.has(entry.kind));
  const focused = learnerMessages.length > 0 || communicationActions.length > 0 ? 1 : 0;
  const closedLoop = entries.some((entry) => entry.kind === 'learner-action' && entry.meta?.some((value) => /team|escalat/i.test(value))) || (learnerMessages.length > 0 && orders.length > 0) ? 1 : 0;
  const orderQuality = orders.length > 0 ? 1 : 0;
  const reasoning = hasNote || learnerMessages.length > 0 ? 1 : 0;
  const communicationBreakdown = {
    focused_information_gathering: { score: focused, feedback: focused ? 'Observed a learner-authored interaction or simulated bedside/team action recorded in the attempt.' : 'Not observed: vitals and clinical orders alone do not establish learner information gathering.', evidence_event_ids: [] },
    closed_loop_team_communication: { score: closedLoop, feedback: closedLoop ? 'Observed learner-authored team escalation/closed-loop communication.' : 'Not observed: no linked learner team communication was captured.', evidence_event_ids: [] },
    efficiency_deduction: { score: 0, feedback: 'No case-specific efficiency deduction; message count and timing are not scored.', evidence_event_ids: [] },
  };
  const clinicalReasoningBreakdown = {
    orders_monitoring_quality: { score: orderQuality, feedback: orderQuality ? 'Observed post-page order, monitoring, result, or reassessment evidence.' : 'No post-page order, monitoring, result, or reassessment evidence was observed.', evidence_event_ids: [] },
    clinical_reasoning_documentation: { score: reasoning, feedback: hasNote ? 'Observed a learner progress note after the scoring boundary.' : 'Observed learner-authored post-page reasoning evidence; a progress note was not observed.', evidence_event_ids: [] },
    safety_deduction: { score: 0, feedback: 'No actual unsafe learner action/order requiring a deduction was observed.', evidence_event_ids: [] },
  };
  return { ...evaluation, communication_score: focused + closedLoop, mdm_score: orderQuality + reasoning, clinical_reasoning_score: orderQuality + reasoning, communication_breakdown: communicationBreakdown, mdm_breakdown: clinicalReasoningBreakdown, clinical_reasoning_breakdown: clinicalReasoningBreakdown };
};
