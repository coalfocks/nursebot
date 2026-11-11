import { sanitizeSimulationText } from './evaluation-scoring.ts';

export type AttemptFeedbackComment = { text: string; evidence_event_ids: string[] };
export type AttemptFeedbackComments = { strengths: [AttemptFeedbackComment, AttemptFeedbackComment]; improvements: [AttemptFeedbackComment, AttemptFeedbackComment] };
export type CommentaryResult =
  | { status: 'generated'; comments: AttemptFeedbackComments; prompt_version: string }
  | { status: 'insufficient_evidence'; explanation: string; prompt_version: string };

export const FEEDBACK_COMMENT_PROMPT_VERSION = 'attempt-specific-comments-v2';
export const FEEDBACK_COMMENT_PROMPT = `Write a short debrief for the learner about this completed simulation. Speak directly to them in plain language, like a clinical preceptor who watched the case.

Use only this attempt’s verified timeline through completion, the case goals and accepted approaches, and the learner’s recorded note. Choose two distinct strengths and two distinct improvements. Write one sentence per comment, up to 25 words each.

For each strength, name something the learner actually did and explain why it helped in this case. For each improvement, name the specific moment or decision and give one concrete action they could take next time, including when or what to communicate if relevant. If the learner handled the case well, suggest a refinement tied to a real moment.

Distinguish what the learner considered, requested, ordered, and completed. A hint displayed, a baseline order, or an action by the nurse, patient, or consultant does not count as learner work. Call something missed only when the available record supports that conclusion. Avoid generic praise, copied rubric language, and invented actions or outcomes.

Return JSON with strengths and improvements, each containing exactly two objects with text and evidence_event_ids. Use only IDs from this attempt. If the evidence cannot support four comments, return an insufficient_evidence status and explain the gap.`;

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

export const validateFeedbackComments = (raw: unknown, allowedEventIds: Set<string>): CommentaryResult | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const prompt_version = FEEDBACK_COMMENT_PROMPT_VERSION;
  if (candidate.status === 'insufficient_evidence') {
    const explanation = typeof candidate.explanation === 'string' ? sanitizeSimulationText(candidate.explanation).trim() : '';
    return explanation ? { status: 'insufficient_evidence', explanation, prompt_version } : null;
  }
  if (!Array.isArray(candidate.strengths) || !Array.isArray(candidate.improvements) || candidate.strengths.length !== 2 || candidate.improvements.length !== 2) return null;
  const parse = (items: unknown[]) => items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    const text = typeof value.text === 'string' ? sanitizeSimulationText(value.text).trim() : '';
    const rawEvidenceIds = Array.isArray(value.evidence_event_ids) ? value.evidence_event_ids : [];
    const evidence_event_ids = rawEvidenceIds.filter((id): id is string => typeof id === 'string');
    const evidenceIsValid = evidence_event_ids.length > 0 && evidence_event_ids.every((id) => allowedEventIds.has(id));
    return text && wordCount(text) <= 25 && evidenceIsValid ? { text, evidence_event_ids } : null;
  });
  const strengths = parse(candidate.strengths);
  const improvements = parse(candidate.improvements);
  if (strengths.some((item) => !item) || improvements.some((item) => !item)) return null;
  return { status: 'generated', comments: { strengths: strengths as [AttemptFeedbackComment, AttemptFeedbackComment], improvements: improvements as [AttemptFeedbackComment, AttemptFeedbackComment] }, prompt_version };
};
