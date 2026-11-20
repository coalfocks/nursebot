// Framing text for the separate FEEDBACK CONTEXT section that generate-feedback appends to the
// evaluator user message. It is NOT part of the evaluator prompt body (simulation-prompt.ts, sha256
// 110b1d34…) and does not change that body or its hash.
//
// STATUS: DRAFT, pending Connor/Codex wording approval. Do not edit the text without bumping the ID and
// re-computing the hash; feedback-context-framing.test.ts fails if text and hash drift apart.
export const FEEDBACK_CONTEXT_FRAMING_ID = 'feedback-context-framing-v1-2026-11-20';
export const FEEDBACK_CONTEXT_FRAMING_SHA256 = '8b51cd13b0679cce7f5e1751edbbd4f78f55a3465fd2c8831abeae23c5320ad8';
export const FEEDBACK_CONTEXT_FRAMING =
  'FEEDBACK CONTEXT (assembled by the system, separate from the evaluator prompt). ' +
  'The case goals and the example progress note are grading references. ' +
  'The patient summary, HPI and other EMR notes are for context only and are not grading criteria. ' +
  'A field marked NOT PROVIDED is missing: do not infer or invent its content.';
