import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALTHEA_SCORING_PROMPT_VERSION, EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { FEEDBACK_COMMENT_PROMPT, FEEDBACK_COMMENT_PROMPT_VERSION } from './feedback-comments';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

// Hashes of the prompt text extracted verbatim from
// "Nurse Althea grading prompts" (Implementation handoff for Bert, Nov 13 2026).
// If these change, re-extract the approved document; do not hand-edit prompt text.
const SCORING_PROMPT_SHA256 = 'a2abc95c5d3f621e77bb13815a99e6fb2cea37e3a92d2789c8f494ce8e622ba5';
const COMMENT_PROMPT_SHA256 = 'a5c8aa31ed45c6990d01deb44984a944c66ed8f8de64ec0bfb3ca889ae26a1e5';

describe('Althea grading prompts', () => {
  it('installs the scoring prompt verbatim from the handoff document', () => {
    expect(sha256(EVALUATION_SYSTEM_PROMPT)).toBe(SCORING_PROMPT_SHA256);
    expect(EVALUATION_SYSTEM_PROMPT).toContain('ROLE AND PURPOSE');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('Observable thresholds for close calls');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('CALIBRATION EXAMPLES');
    expect(ALTHEA_SCORING_PROMPT_VERSION).toBe('althea-scoring-prompt-2026-11-13');
  });

  it('installs the commentary prompt verbatim as attempt-specific-comments-v2', () => {
    expect(FEEDBACK_COMMENT_PROMPT_VERSION).toBe('attempt-specific-comments-v2');
    expect(sha256(FEEDBACK_COMMENT_PROMPT)).toBe(COMMENT_PROMPT_SHA256);
  });
});
