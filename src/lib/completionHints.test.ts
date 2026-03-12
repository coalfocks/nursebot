import { describe, expect, it } from 'vitest';
import {
  getViewedCompletionHints,
  parseCompletionHints,
  parseCompletionHintViews,
  recordCompletionHintView,
} from './completionHints';

describe('completionHints', () => {
  it('parses structured completion hints from JSON', () => {
    expect(
      parseCompletionHints(
        JSON.stringify({
          assessmentHint: 'Summarize the problem representation.',
          diagnosisDifferentiatorHint: 'Explain why sepsis is more likely than PE.',
          planHint: 'Name immediate management priorities.',
        }),
      ),
    ).toEqual({
      assessmentHint: 'Summarize the problem representation.',
      diagnosisDifferentiatorHint: 'Explain why sepsis is more likely than PE.',
      planHint: 'Name immediate management priorities.',
    });
  });

  it('records first-view timestamps without overwriting existing ones', () => {
    const first = recordCompletionHintView({}, 'assessmentHint', '2026-03-12T10:00:00.000Z');
    const second = recordCompletionHintView(first, 'assessmentHint', '2026-03-12T10:05:00.000Z');

    expect(first).toEqual({
      assessmentHint: {
        viewedAt: '2026-03-12T10:00:00.000Z',
      },
    });
    expect(second).toEqual(first);
  });

  it('returns only hints that were actually viewed', () => {
    const hints = parseCompletionHints(`
Assessment Hint: Write a one-line summary.
Diagnosis Differentiator Hint: Contrast cardiogenic and septic shock.
Plan Hint: Include immediate stabilization steps.
`);
    const views = parseCompletionHintViews({
      assessmentHint: { viewedAt: '2026-03-12T10:00:00.000Z' },
      planHint: { viewedAt: '2026-03-12T10:02:00.000Z' },
    });

    expect(getViewedCompletionHints(hints, views)).toEqual([
      {
        key: 'assessmentHint',
        label: 'Assessment hint',
        content: 'Write a one-line summary.',
        viewedAt: '2026-03-12T10:00:00.000Z',
      },
      {
        key: 'planHint',
        label: 'Plan hint',
        content: 'Include immediate stabilization steps.',
        viewedAt: '2026-03-12T10:02:00.000Z',
      },
    ]);
  });
});
