import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { FEEDBACK_COMMENT_PROMPT_VERSION, validateFeedbackComments } from './feedback-comments.ts';

const ids = new Set(['message-1', 'order-1', 'note-1', 'completion-1']);
const valid = {
  strengths: [
    { text: 'You asked about dizziness before ordering fluids, which clarified the immediate perfusion concern.', evidence_event_ids: ['message-1'] },
    { text: 'You ordered repeat vitals and documented the reassessment plan, supporting timely monitoring.', evidence_event_ids: ['order-1', 'note-1'] },
  ] as [{ text: string; evidence_event_ids: string[] }, { text: string; evidence_event_ids: string[] }],
  improvements: [
    { text: 'You could tell the nurse when you will repeat vitals so the monitoring plan is closed loop.', evidence_event_ids: ['message-1'] },
    { text: 'You could document the consultant response after reviewing it, making the final decision easier to follow.', evidence_event_ids: ['completion-1'] },
  ] as [{ text: string; evidence_event_ids: string[] }, { text: string; evidence_event_ids: string[] }],
};

Deno.test('accepts four evidence-linked comments and records the prompt version', () => {
  assertEquals(validateFeedbackComments(valid, ids), { status: 'generated', comments: valid, prompt_version: FEEDBACK_COMMENT_PROMPT_VERSION });
});

Deno.test('rejects a comment that cites an event outside this attempt', () => {
  assert(!validateFeedbackComments({ ...valid, strengths: [{ ...valid.strengths[0], evidence_event_ids: ['other-attempt'] }, valid.strengths[1]] }, ids));
});

Deno.test('accepts an explicit insufficient-evidence response', () => {
  assertEquals(validateFeedbackComments({ status: 'insufficient_evidence', explanation: 'The attempt does not contain enough learner-authored evidence.' }, ids), { status: 'insufficient_evidence', explanation: 'The attempt does not contain enough learner-authored evidence.', prompt_version: FEEDBACK_COMMENT_PROMPT_VERSION });
});
