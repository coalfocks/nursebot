import { describe, expect, it } from 'vitest';
import { classifyFeedbackScore, LEGACY_FEEDBACK_SCORE_EXPLANATION } from './feedbackScore';

describe('classifyFeedbackScore', () => {
  it('formats canonical rubric scores from 0 through 5', () => {
    expect(classifyFeedbackScore(0)).toEqual({ kind: 'canonical', rawScore: 0, displayText: '0/5', explanation: null });
    expect(classifyFeedbackScore(4.5).displayText).toBe('4.5/5');
    expect(classifyFeedbackScore(5).displayText).toBe('5/5');
  });

  it('preserves and safely labels legacy overall scores', () => {
    expect(classifyFeedbackScore(68, 'legacy')).toEqual({
      kind: 'legacy',
      rawScore: 68,
      displayText: 'Legacy score: 68 (historical overall grade; not the current 0–5 rubric)',
      explanation: LEGACY_FEEDBACK_SCORE_EXPLANATION,
    });
    expect(classifyFeedbackScore(68, 'legacy').displayText).not.toContain('/5');
    expect(classifyFeedbackScore(0, 'legacy').displayText).toContain('Legacy score: 0');
  });

  it('does not treat missing or non-finite values as scores', () => {
    expect(classifyFeedbackScore(null).kind).toBe('missing');
    expect(classifyFeedbackScore(Number.NaN).kind).toBe('missing');
  });
});
