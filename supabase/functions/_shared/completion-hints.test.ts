import { describe, expect, it } from 'vitest';
import {
  formatViewedCompletionHintsForEvaluation,
  getViewedCompletionHints,
  parseCompletionHintViews,
  parseCompletionHints,
} from './completion-hints';

describe('completion-hint feedback evidence contract', () => {
  it('formats only viewed authored hints as contextual grading input', () => {
    const viewed = getViewedCompletionHints(
      parseCompletionHints(JSON.stringify({
        assessmentHint: 'Check perfusion and trend vitals.',
        diagnosisDifferentiatorHint: 'Consider the competing diagnosis.',
        planHint: 'Reassess after the first intervention.',
      })),
      parseCompletionHintViews({
        assessmentHint: { viewedAt: '2026-10-29T20:00:00Z' },
        planHint: { viewedAt: '2026-10-29T20:01:00Z' },
      }),
    );

    expect(viewed).toHaveLength(2);
    expect(formatViewedCompletionHintsForEvaluation(viewed)).toContain('Assessment hint');
    expect(formatViewedCompletionHintsForEvaluation(viewed)).toContain('Plan hint');
    expect(formatViewedCompletionHintsForEvaluation(viewed)).not.toContain('competing diagnosis');
  });
});
