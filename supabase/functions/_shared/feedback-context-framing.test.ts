import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_CONTEXT_FRAMING, FEEDBACK_CONTEXT_FRAMING_ID, FEEDBACK_CONTEXT_FRAMING_SHA256 } from './feedback-context-framing';
import { NURSE_ALTHEA_SIMULATION_PROMPT, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 } from './simulation-prompt';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

describe('feedback context framing constant', () => {
  it('has a versioned ID and a hash that matches its text', () => {
    expect(FEEDBACK_CONTEXT_FRAMING_ID).toBe('feedback-context-framing-v1-2026-11-20');
    expect(sha(FEEDBACK_CONTEXT_FRAMING)).toBe(FEEDBACK_CONTEXT_FRAMING_SHA256);
  });
  it('states the grading-vs-context split and the no-invention rule', () => {
    expect(FEEDBACK_CONTEXT_FRAMING).toMatch(/case goals and the example progress note are grading references/);
    expect(FEEDBACK_CONTEXT_FRAMING).toMatch(/HPI and other EMR notes are for context only and are not grading criteria/);
    expect(FEEDBACK_CONTEXT_FRAMING).toMatch(/NOT PROVIDED/);
  });
  it('leaves the evaluator prompt body and its hash untouched', () => {
    expect(NURSE_ALTHEA_SIMULATION_PROMPT_SHA256.startsWith('110b1d34')).toBe(true);
    expect(sha(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(NURSE_ALTHEA_SIMULATION_PROMPT_SHA256);
    expect(NURSE_ALTHEA_SIMULATION_PROMPT).not.toContain('FEEDBACK CONTEXT');
  });
});
