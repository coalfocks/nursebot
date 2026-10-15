export interface EvaluationScoringResponse {
  learning_objectives: string;
  communication_score: number;
  mdm_score: number;
  communication_breakdown: {
    focused_information_gathering: { score: number; feedback: string; evidence_event_ids?: string[] };
    closed_loop_team_communication: { score: number; feedback: string; evidence_event_ids?: string[] };
  };
  mdm_breakdown: {
    orders_monitoring_quality: { score: number; feedback: string; evidence_event_ids?: string[] };
    clinical_reasoning_documentation: { score: number; feedback: string; evidence_event_ids?: string[] };
  };
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

export const canonicalizeEvaluation = (raw: Partial<EvaluationScoringResponse>): EvaluationScoringResponse => {
  const source = raw as Record<string, any>;
  const communication = (source.communication_breakdown ?? source.communication ?? {}) as Record<string, any>;
  const mdm = (source.mdm_breakdown ?? source.medical_decision_making ?? source.mdm ?? {}) as Record<string, any>;
  const focusedRaw = communication.focused_information_gathering
    ?? communication.information_gathering
    ?? communication.information_sharing
    ?? communication.focused_gathering;
  const closedLoopRaw = communication.closed_loop_team_communication
    ?? communication.closed_loop_communication
    ?? communication.responsive_communication
    ?? communication.team_communication;
  const ordersRaw = mdm.orders_monitoring_quality
    ?? mdm.orders_monitoring
    ?? mdm.labs_orders_quality
    ?? mdm.orders_quality;
  const reasoningRaw = mdm.clinical_reasoning_documentation
    ?? mdm.reasoning_documentation
    ?? mdm.note_thought_process
    ?? mdm.reasoning;
  const componentScore = (component: Record<string, any> | undefined) => component?.score ?? component?.value ?? component?.points ?? 0;
  const focused = clamp(componentScore(focusedRaw), 0, 2);
  const closedLoop = clamp(componentScore(closedLoopRaw), 0, 3);
  const orders = clamp(componentScore(ordersRaw), 0, 3);
  const reasoning = clamp(componentScore(reasoningRaw), 0, 2);
  const safety = raw.safety_result?.level === 'critical' || raw.safety_result?.level === 'concern' ? raw.safety_result.level : 'none';
  return {
    learning_objectives: text(raw.learning_objectives, 'Review the evidence-linked strengths and next steps below.'),
    communication_score: focused + closedLoop,
    mdm_score: orders + reasoning,
    communication_breakdown: {
      focused_information_gathering: { score: focused, feedback: text(focusedRaw?.feedback, 'Insufficient evidence to assess focused information gathering.'), evidence_event_ids: ids(focusedRaw?.evidence_event_ids) },
      closed_loop_team_communication: { score: closedLoop, feedback: text(closedLoopRaw?.feedback, 'Insufficient evidence to assess closed-loop team communication.'), evidence_event_ids: ids(closedLoopRaw?.evidence_event_ids) },
    },
    mdm_breakdown: {
      orders_monitoring_quality: { score: orders, feedback: text(ordersRaw?.feedback, 'Insufficient evidence to assess orders and monitoring.'), evidence_event_ids: ids(ordersRaw?.evidence_event_ids) },
      clinical_reasoning_documentation: { score: reasoning, feedback: text(reasoningRaw?.feedback, 'Insufficient evidence to assess clinical reasoning and documentation.'), evidence_event_ids: ids(reasoningRaw?.evidence_event_ids) },
    },
    safety_result: { level: safety, action: raw.safety_result?.action ?? null, rationale: raw.safety_result?.rationale ?? null, evidence_event_ids: ids(raw.safety_result?.evidence_event_ids) },
    strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((v): v is string => typeof v === 'string') : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.filter((v): v is string => typeof v === 'string') : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.filter((v): v is string => typeof v === 'string') : [],
  };
};

export const hasMeaningfulEvidence = (sourceEventIds: string[]) => sourceEventIds.length > 0;

type EvidenceShape = { kind: string; title: string; body?: string };

/**
 * Conservative safety net for a malformed evaluator response. It uses only
 * learner-authored post-page evidence and never treats the nurse page itself
 * as learner performance. This is intentionally a small evidence floor, not
 * a replacement for case-aware model scoring.
 */
export const buildEvidenceBackedFallback = (
  evaluation: EvaluationScoringResponse,
  entries: EvidenceShape[],
  progressNote: string | null | undefined,
): EvaluationScoringResponse | null => {
  if (evaluation.communication_score !== 0 || evaluation.mdm_score !== 0) return evaluation;
  const learnerMessages = entries.filter((entry) => entry.kind === 'message' && entry.title === 'Student message');
  const orders = entries.filter((entry) => entry.kind === 'order' || entry.kind === 'labs' || entry.kind === 'vital' || entry.kind === 'imaging');
  const hasNote = Boolean(progressNote?.trim());
  if (learnerMessages.length === 0 && orders.length === 0 && !hasNote) return null;
  // Assignment-scoped clinical actions are learner evidence even when the
  // bedside-first flow produced no persisted chat message. Never count a
  // nurse-page message here: the fallback only receives post-page entries.
  const focused = learnerMessages.length > 0 || orders.length > 0 || hasNote ? 1 : 0;
  // A note/order can support bedside assessment and MDM, but cannot prove
  // closed-loop team communication without an observed learner message.
  const closedLoop = learnerMessages.length > 0 && orders.length > 0 ? 1 : 0;
  const orderQuality = orders.length > 0 ? 1 : 0;
  const reasoning = hasNote || learnerMessages.length > 0 ? 1 : 0;
  return {
    ...evaluation,
    learning_objectives: evaluation.learning_objectives,
    communication_score: focused + closedLoop,
    mdm_score: orderQuality + reasoning,
    communication_breakdown: {
      focused_information_gathering: { score: focused, feedback: 'Observed learner-authored post-page bedside or clinical-action evidence; detailed component evidence was recovered conservatively.', evidence_event_ids: [] },
      closed_loop_team_communication: { score: closedLoop, feedback: closedLoop ? 'Observed learner-authored communication paired with a post-page clinical action.' : 'No linked post-page clinical action was observed for closed-loop communication.', evidence_event_ids: [] },
    },
    mdm_breakdown: {
      orders_monitoring_quality: { score: orderQuality, feedback: orderQuality ? 'Observed post-page order, monitoring, result, or reassessment evidence.' : 'No post-page order, monitoring, result, or reassessment evidence was observed.', evidence_event_ids: [] },
      clinical_reasoning_documentation: { score: reasoning, feedback: hasNote ? 'Observed a learner progress note after the scoring boundary.' : 'Observed learner-authored post-page reasoning evidence; a progress note was not observed.', evidence_event_ids: [] },
    },
  };
};
