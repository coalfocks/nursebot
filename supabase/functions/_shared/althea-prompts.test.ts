import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALTHEA_SAFETY_EVIDENCE_RULE_VERSION, ALTHEA_SCORING_PROMPT_VERSION, EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { NURSE_ALTHEA_SIMULATION_PROMPT, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 } from './simulation-prompt';
import { FEEDBACK_COMMENT_PROMPT, FEEDBACK_COMMENT_PROMPT_VERSION } from './feedback-comments';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

// Hashes of the composed prompt text (simulation-evidence prompt
// nurse-althea-simulation-evidence-v1-2026-11-18 + the approved Nov 13 rubric
// anchors with the simulator-conflicting sentences replaced). The scoring hash
// covers the whole composed string. If these change, re-check the approved
// documents; do not hand-edit prompt text.
// Revised 2026-11-19 to add the safety-evidence rule (safety-evidence-rule-v1-2026-11-19). The simulation block itself is still verbatim (checked below).
const SCORING_PROMPT_SHA256 = 'd7cbeaaba17fcad1c1516c8f2cc1d2ee7a5ffa518bba5e53c61f05143a922e29';
const COMMENT_PROMPT_SHA256 = '25b6e53f5697932fe96739343cb915bdb20f6293f31302900b7bcb8b43cf67ee';

describe('Althea grading prompts', () => {
  it('installs the scoring prompt verbatim from the handoff document', () => {
    expect(sha256(EVALUATION_SYSTEM_PROMPT)).toBe(SCORING_PROMPT_SHA256);
    expect(EVALUATION_SYSTEM_PROMPT).toContain('ROLE AND PURPOSE');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('Observable thresholds for close calls');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('CALIBRATION EXAMPLES');
    expect(ALTHEA_SCORING_PROMPT_VERSION).toBe('nurse-althea-simulation-evidence-v1-2026-11-18');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('Describe an order as placed and a nurse reply as acknowledged.');
  });

  it('keeps the simulation-evidence block verbatim and carries the safety-evidence rule', () => {
    expect(sha256(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(NURSE_ALTHEA_SIMULATION_PROMPT_SHA256);
    expect(EVALUATION_SYSTEM_PROMPT.startsWith(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(true);
    expect(ALTHEA_SAFETY_EVIDENCE_RULE_VERSION).toBe('safety-evidence-rule-v1-2026-11-19');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('SAFETY EVIDENCE RULE (safety-evidence-rule-v1-2026-11-19)');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('does NOT by itself make safety a concern');
  });

  it('installs the commentary prompt as attempt-specific-comments-v3', () => {
    expect(FEEDBACK_COMMENT_PROMPT_VERSION).toBe('attempt-specific-comments-v3-2026-11-18');
    expect(sha256(FEEDBACK_COMMENT_PROMPT)).toBe(COMMENT_PROMPT_SHA256);
  });
});
