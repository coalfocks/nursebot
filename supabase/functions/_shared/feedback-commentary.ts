import { sanitizeSimulationText, type EvaluationScoringResponse } from './evaluation-scoring.ts';

export const COMMENTARY_VERSION = 'feedback-commentary-v4-2026-10-20';

export const NARRATIVE_COMMENTARY_V4 = `NURSE ALTHEA FEEDBACK COMMENTARY v4
Write brief, useful formative feedback about this simulation, organized around medical decision-making and communication. This prompt governs feedback wording only. The existing assessment rubric, component anchors, numeric scores, deductions, weights and clinical completion status are fixed outside this task. Do not add scores or change them.

Medical decision-making: explain how the physician framed the problem, used the information available at the time, prioritized the actual orders/management and documented reasoning and reassessment. Credit sound alternatives and appropriate use of existing treatment. Distinguish an order from administration, an intended action from a recorded action, and a reassessment plan from a result actually supplied.
Communication: identify focused questions, useful information sharing, clear team/consultant updates, responsibility and follow-through. Credit appropriate bedside-first/team interaction across all channels. Do not judge quality by message count, length, perfect SBAR wording or missing nurse texts alone.

Use the ACGME competencies as background for useful comments: patient care and medical knowledge in the clinical decisions; interpersonal/communication skills in the exchanges; systems-based practice in team/resource coordination; practice-based learning in an actually recorded reassessment or plan revision; professionalism in directly observed respect, honesty and response to patient preferences. Do not force six headings, six ratings or an example for every competency. Never infer a Milestone level, personality or overall competence from this encounter.

Ground every comment in attributable current-attempt evidence after the first nurse page. Baseline, simulator/system activity and prior attempts are context, not physician accomplishments. Use only valid supplied evidence IDs. Never invent findings, treatment response, missing actions or a safety event. Check chats, actual orders/results and the final note before claiming something was omitted. In particular, if the physician specified repeat observations within15minutes, do not say a reassessment interval was missing. If the platform supplied no repeat observations, describe the result as unavailable.

Give at most3specific strengths and3actionable improvements; fewer is appropriate. Each bullet contains one authored point, normally at most25words. A strength names a recorded choice and why it helped. An improvement names an evidenced gap and a concrete next-case action, including the relevant condition or timing. Prioritize useful learning over a checklist. Do not repeat one issue under multiple labels or manufacture a growth target when the evidence supports none.

Do not blame the physician for failed consultant transport, unavailable controls/results, result-generation failures or technical retries. Do not ask for duplicate existing orders or require unavailable simulated examination/response data. Describe evidence/opportunity limits honestly. Be specific and respectful; avoid generic praise, stock score-level paragraphs and vague instructions to communicate better or order appropriate tests.

Keep medical decision-making and communication recognizable in the comments. ACGME terminology can guide the wording quietly; use a competency label only when it clarifies a specific learning point. Show room/diagnosis once and concise case-goal bullets using existing fields. Keep the visible summary within one printed page; expanded evidence must match it.

Return only the existing allowed narrative fields, including specific component-feedback text when supported by the supplied narrative schema. Do not return or mutate numeric scores, deduction values, safety classifications, rubric/anchor versions, assignment status or pins. The server retains the already validated scoring result unchanged. Missing evidence or failed narrative validation must be reported through the technical error path, never replaced with invented feedback or a fabricated grade.`;

export type NarrativeComponent = { feedback: string; evidence_event_ids: string[] };
export type NarrativeCommentary = {
  learning_objectives: string;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  component_feedback?: Partial<Record<
    'focused_information_gathering' | 'closed_loop_team_communication' | 'efficiency_deduction' |
    'orders_monitoring_quality' | 'clinical_reasoning_documentation' | 'safety_deduction',
    NarrativeComponent
  >>;
  action_review: Array<{ label: string; explanation: string; evidence_event_ids: string[] }>;
};

const clean = (value: unknown) => typeof value === 'string' ? sanitizeSimulationText(value.trim()) : '';
const strings = (value: unknown, max: number) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, max)
  : [];
const evidenceIds = (value: unknown, allowed: Set<string>) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && allowed.has(item))
  : [];

export const applyNarrativeCommentary = (
  scoring: EvaluationScoringResponse,
  raw: Record<string, unknown>,
  validEvidenceIds: string[],
): { evaluation: EvaluationScoringResponse; commentary: NarrativeCommentary } => {
  const allowed = new Set(validEvidenceIds);
  const componentSource = raw.component_feedback && typeof raw.component_feedback === 'object' && !Array.isArray(raw.component_feedback)
    ? raw.component_feedback as Record<string, unknown>
    : {};
  const componentFeedback: NarrativeCommentary['component_feedback'] = {};
  const componentKeys = [
    'focused_information_gathering', 'closed_loop_team_communication', 'efficiency_deduction',
    'orders_monitoring_quality', 'clinical_reasoning_documentation', 'safety_deduction',
  ] as const;
  for (const key of componentKeys) {
    const item = componentSource[key];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const feedback = clean((item as Record<string, unknown>).feedback);
    if (!feedback) continue;
    componentFeedback[key] = { feedback, evidence_event_ids: evidenceIds((item as Record<string, unknown>).evidence_event_ids, allowed) };
  }
  const actionReview = Array.isArray(raw.action_review)
    ? raw.action_review.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const label = clean(row.label);
      const explanation = clean(row.explanation);
      if (!label || !explanation) return [];
      return [{ label, explanation, evidence_event_ids: evidenceIds(row.evidence_event_ids, allowed) }];
    }).slice(0, 20)
    : [];
  if (!clean(raw.learning_objectives) || !Array.isArray(raw.strengths) || !Array.isArray(raw.improvements) || !Array.isArray(raw.recommendations) || !Array.isArray(raw.action_review)) {
    throw new Error('Narrative commentary failed the allowed-field contract');
  }
  const commentary: NarrativeCommentary = {
    learning_objectives: clean(raw.learning_objectives),
    strengths: strings(raw.strengths, 3),
    improvements: strings(raw.improvements, 3),
    recommendations: strings(raw.recommendations, 3),
    action_review: actionReview,
  };
  if (Object.keys(componentFeedback).length) commentary.component_feedback = componentFeedback;

  const evaluation: EvaluationScoringResponse = {
    ...scoring,
    learning_objectives: commentary.learning_objectives,
    strengths: commentary.strengths,
    improvements: commentary.improvements,
    recommendations: commentary.recommendations,
    communication_breakdown: { ...scoring.communication_breakdown },
    mdm_breakdown: { ...scoring.mdm_breakdown },
    clinical_reasoning_breakdown: { ...scoring.clinical_reasoning_breakdown },
  };
  const map = [
    ['focused_information_gathering', 'communication_breakdown'],
    ['closed_loop_team_communication', 'communication_breakdown'],
    ['efficiency_deduction', 'communication_breakdown'],
    ['orders_monitoring_quality', 'clinical_reasoning_breakdown'],
    ['clinical_reasoning_documentation', 'clinical_reasoning_breakdown'],
    ['safety_deduction', 'clinical_reasoning_breakdown'],
  ] as const;
  for (const [key, group] of map) {
    const narrative = componentFeedback[key];
    if (!narrative) continue;
    const component = (evaluation[group] as unknown as Record<string, { score: number; feedback: string; evidence_event_ids?: string[] }>)[key];
    component.feedback = narrative.feedback;
    component.evidence_event_ids = narrative.evidence_event_ids;
  }
  return { evaluation, commentary };
};
