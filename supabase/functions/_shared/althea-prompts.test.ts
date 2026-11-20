import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALTHEA_SCORING_PROMPT_VERSION, APPROVED_RUBRIC_ANCHORS, EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { NURSE_ALTHEA_SIMULATION_PROMPT, NURSE_ALTHEA_SIMULATION_PROMPT_ID, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 } from './simulation-prompt';
import { FEEDBACK_COMMENT_PROMPT, FEEDBACK_COMMENT_PROMPT_VERSION } from './feedback-comments';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

// Codex's supplied simulation-evidence prompt body (BEGIN PROMPT..END PROMPT, trimmed), the same body hash PR #45 names.
const SIMULATION_BODY_SHA256 = '110b1d349f396a414b8bf9d4d5388323672084ea3295e86be435c218a123fa18';
// Approved Nov 13 rubric anchors and commentary prompt: unchanged from main. Do not hand-edit prompt text.
const RUBRIC_ANCHORS_SHA256 = 'a2abc95c5d3f621e77bb13815a99e6fb2cea37e3a92d2789c8f494ce8e622ba5';
const COMMENT_PROMPT_SHA256 = 'a5c8aa31ed45c6990d01deb44984a944c66ed8f8de64ec0bfb3ca889ae26a1e5';

describe('Althea grading prompts', () => {
  it('installs the simulation-evidence body verbatim (sha256 110b1d34…)', () => {
    expect(sha256(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(SIMULATION_BODY_SHA256);
    expect(NURSE_ALTHEA_SIMULATION_PROMPT_SHA256).toBe(SIMULATION_BODY_SHA256);
    expect(NURSE_ALTHEA_SIMULATION_PROMPT_ID).toBe('nurse-althea-simulation-evidence-v1-2026-11-18');
    expect(ALTHEA_SCORING_PROMPT_VERSION).toBe('nurse-althea-simulation-evidence-v1-2026-11-18');
  });

  it('assembles the evaluator prompt as the verbatim body followed by the unchanged approved rubric anchors', () => {
    expect(EVALUATION_SYSTEM_PROMPT).toBe(`${NURSE_ALTHEA_SIMULATION_PROMPT}\n\n${APPROVED_RUBRIC_ANCHORS}`);
    expect(EVALUATION_SYSTEM_PROMPT.startsWith(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(true);
    expect(sha256(APPROVED_RUBRIC_ANCHORS)).toBe(RUBRIC_ANCHORS_SHA256);
    expect(EVALUATION_SYSTEM_PROMPT).toContain('Observable thresholds for close calls');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('CALIBRATION EXAMPLES');
  });

  it('leaves the commentary prompt unchanged', () => {
    expect(FEEDBACK_COMMENT_PROMPT_VERSION).toBe('attempt-specific-comments-v2');
    expect(sha256(FEEDBACK_COMMENT_PROMPT)).toBe(COMMENT_PROMPT_SHA256);
  });
});
