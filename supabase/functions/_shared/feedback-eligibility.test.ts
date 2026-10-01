import { describe, expect, it } from 'vitest';
import { isFeedbackEligibleStatus } from './feedback-eligibility';

describe('feedback eligibility', () => {
  it('allows only explicitly completed assignments', () => {
    expect(isFeedbackEligibleStatus('completed')).toBe(true);
    expect(isFeedbackEligibleStatus('bedside')).toBe(false);
    expect(isFeedbackEligibleStatus('in_progress')).toBe(false);
    expect(isFeedbackEligibleStatus('assigned')).toBe(false);
  });
});
