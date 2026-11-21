import { describe, it, expect } from 'vitest';
import { rejectedFeedbackDiagnostic } from './rejected-feedback.ts';
describe('rejected candidate retention', () => {
  it('retains exact text and path without exposing reusable feedback', () => {
    const text = 'No consultant communication was recorded.\nUnmodified.';
    const candidate = { evaluation: { communication_breakdown: { feedback: text } } };
    const result = rejectedFeedbackDiagnostic(candidate, ['gate failed']);
    expect(result.candidate).toEqual(candidate);
    expect(result.texts).toContainEqual({ location: 'candidate.evaluation.communication_breakdown.feedback', type: 'string', text });
    expect(result).not.toHaveProperty('evaluation');
    expect(result).not.toHaveProperty('debrief');
    expect(result.status).toBe('rejected');
  });
});
