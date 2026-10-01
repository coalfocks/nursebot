import { describe, expect, it } from 'vitest';
import { isFeedbackEligibleStatus } from './feedbackEligibility';

describe('isFeedbackEligibleStatus', () => {
  it('allows only explicitly completed assignments', () => {
    expect(isFeedbackEligibleStatus('completed')).toBe(true);
    expect(isFeedbackEligibleStatus('bedside')).toBe(false);
    expect(isFeedbackEligibleStatus('in_progress')).toBe(false);
    expect(isFeedbackEligibleStatus('assigned')).toBe(false);
    expect(isFeedbackEligibleStatus(null)).toBe(false);
  });
});
