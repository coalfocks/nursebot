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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? Math.round(value) : min));
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

export const canonicalizeEvaluation = (raw: Partial<EvaluationScoringResponse>): EvaluationScoringResponse => {
  const focused = clamp(raw.communication_breakdown?.focused_information_gathering?.score ?? 0, 0, 2);
  const closedLoop = clamp(raw.communication_breakdown?.closed_loop_team_communication?.score ?? 0, 0, 3);
  const orders = clamp(raw.mdm_breakdown?.orders_monitoring_quality?.score ?? 0, 0, 3);
  const reasoning = clamp(raw.mdm_breakdown?.clinical_reasoning_documentation?.score ?? 0, 0, 2);
  const safety = raw.safety_result?.level === 'critical' || raw.safety_result?.level === 'concern' ? raw.safety_result.level : 'none';
  return {
    learning_objectives: text(raw.learning_objectives, 'Review the evidence-linked strengths and next steps below.'),
    communication_score: focused + closedLoop,
    mdm_score: orders + reasoning,
    communication_breakdown: {
      focused_information_gathering: { score: focused, feedback: text(raw.communication_breakdown?.focused_information_gathering?.feedback, 'Insufficient evidence to assess focused information gathering.'), evidence_event_ids: ids(raw.communication_breakdown?.focused_information_gathering?.evidence_event_ids) },
      closed_loop_team_communication: { score: closedLoop, feedback: text(raw.communication_breakdown?.closed_loop_team_communication?.feedback, 'Insufficient evidence to assess closed-loop team communication.'), evidence_event_ids: ids(raw.communication_breakdown?.closed_loop_team_communication?.evidence_event_ids) },
    },
    mdm_breakdown: {
      orders_monitoring_quality: { score: orders, feedback: text(raw.mdm_breakdown?.orders_monitoring_quality?.feedback, 'Insufficient evidence to assess orders and monitoring.'), evidence_event_ids: ids(raw.mdm_breakdown?.orders_monitoring_quality?.evidence_event_ids) },
      clinical_reasoning_documentation: { score: reasoning, feedback: text(raw.mdm_breakdown?.clinical_reasoning_documentation?.feedback, 'Insufficient evidence to assess clinical reasoning and documentation.'), evidence_event_ids: ids(raw.mdm_breakdown?.clinical_reasoning_documentation?.evidence_event_ids) },
    },
    safety_result: { level: safety, action: raw.safety_result?.action ?? null, rationale: raw.safety_result?.rationale ?? null, evidence_event_ids: ids(raw.safety_result?.evidence_event_ids) },
    strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((v): v is string => typeof v === 'string') : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.filter((v): v is string => typeof v === 'string') : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.filter((v): v is string => typeof v === 'string') : [],
  };
};
