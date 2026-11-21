import { FEEDBACK_COMMENT_PROMPT } from './feedback-comments.ts';

// Extracted without changing the existing initial request or authored instructions.
export const buildCommentaryContext = (input: {
  goals: string[];
  timeline: string;
  note: string | null | undefined;
  evidenceManifest: string;
  validationNote?: string;
}) => `${FEEDBACK_COMMENT_PROMPT}\n\nCASE GOALS:\n${input.goals.join('\n') || 'Not recorded.'}\n\nVERIFIED ATTEMPT TIMELINE:\n${input.timeline}\n\nLEARNER NOTE:\n${input.note || 'Not observed.'}\n\nVALID EVIDENCE IDS:\n${input.evidenceManifest}${input.validationNote ?? ''}`;

// Repair needs the same verified sources as the initial request, not just valid IDs.
// The repair instructions and candidate bytes remain unchanged.
export const buildCommentaryRepairContent = (sourceContext: string, rawContent: string) =>
  `${sourceContext}\n\nCANDIDATE JSON TO REPAIR:\n${rawContent}\n\nREPAIR REQUIREMENTS: strengths and improvements must each contain exactly two objects; every object must contain text and evidence_event_ids; use only the valid IDs above; each text must be one sentence of no more than 25 words.`;
