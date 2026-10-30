import { describe, expect, it } from 'vitest';
import { ASSESSMENT_VERSION } from './feedback-contract';
import { withFrozenMarProvenance } from './feedback-assignment-provenance';

describe('feedback completion provenance', () => {
  it.each([
    ['technical-incomplete', { feedback_status: 'completed', technical_incomplete: true }],
    ['successful', { feedback_status: 'completed', technical_incomplete: false, communication_score: 4 }],
  ])('preserves the frozen MAR key for %s completion', (_branch, update) => {
    const completed = withFrozenMarProvenance(
      { case_key_version: 'room-24-mar-v1' },
      update,
    );

    expect(completed.case_key_version).toBe('room-24-mar-v1');
    expect(completed.assessment_version).toBe(ASSESSMENT_VERSION);
  });

  it('does not substitute the evaluated case key or fallback key into the MAR field', () => {
    const completed = withFrozenMarProvenance(
      { case_key_version: null },
      { case_key_version: 'evaluation-case-v9' },
    );

    expect(completed.case_key_version).toBeNull();
    expect(completed.case_key_version).not.toBe('evaluation-case-v9');
    expect(completed.assessment_version).toBe(ASSESSMENT_VERSION);
  });
});
