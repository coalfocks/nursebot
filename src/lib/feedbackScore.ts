export const LEGACY_FEEDBACK_SCORE_EXPLANATION =
  'This value comes from the historical overall_grade/nurse_feedback.overall_score field; it is not a Communication or MDM score.';

export type FeedbackScoreDisplay =
  | { kind: 'canonical'; rawScore: number; displayText: string; explanation: null }
  | { kind: 'legacy'; rawScore: number; displayText: string; explanation: string }
  | { kind: 'missing'; rawScore: null; displayText: string; explanation: null };

/** Classify stored feedback scores without changing the stored value. */
export function classifyFeedbackScore(value: unknown, source: 'canonical' | 'legacy' = 'canonical'): FeedbackScoreDisplay {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { kind: 'missing', rawScore: null, displayText: 'No score recorded', explanation: null };
  }

  if (source === 'canonical' && value >= 0 && value <= 5) {
    return { kind: 'canonical', rawScore: value, displayText: `${value}/5`, explanation: null };
  }

  return {
    kind: 'legacy',
    rawScore: value,
    displayText: `Legacy score: ${value} (historical overall grade; not the current 0–5 rubric)`,
    explanation: LEGACY_FEEDBACK_SCORE_EXPLANATION,
  };
}
