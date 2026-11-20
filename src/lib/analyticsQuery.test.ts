import { describe, expect, it } from 'vitest';
import { buildAnalyticsSelect, describeAnalyticsLoadError, isMissingCaseStartColumn } from './analyticsQuery';

// Exact PostgREST error returned by prod before the case_started_at migration (reproduced read-only 2026-11-20).
const prodError = { code: '42703', details: null, hint: null, message: 'column student_room_assignments.case_started_at does not exist' };

describe('pre-migration analytics query', () => {
  it('selects case_started_at only when asked, and keeps every other column and relation', () => {
    expect(buildAnalyticsSelect(true)).toContain('case_started_at');
    const pre = buildAnalyticsSelect(false);
    expect(pre).not.toContain('case_started_at');
    for (const column of ['scoring_start_at', 'completed_at', 'feedback_debrief', 'nurse_feedback', 'student:student_id', 'room:room_id', 'school:school_id']) {
      expect(pre).toContain(column);
      expect(buildAnalyticsSelect(true)).toContain(column);
    }
  });

  it('recognises only the missing case_started_at column as the pre-migration case', () => {
    expect(isMissingCaseStartColumn(prodError)).toBe(true);
    expect(isMissingCaseStartColumn({ code: '42703', message: 'column student_room_assignments.other_col does not exist' })).toBe(false);
    expect(isMissingCaseStartColumn({ code: '42501', message: 'permission denied for table student_room_assignments' })).toBe(false);
    expect(isMissingCaseStartColumn(new Error('network'))).toBe(false);
    expect(isMissingCaseStartColumn(null)).toBe(false);
  });
});

describe('describeAnalyticsLoadError', () => {
  it('shows the real PostgREST error instead of the generic sentence', () => {
    expect(describeAnalyticsLoadError(prodError)).toBe('Analytics could not be loaded: column student_room_assignments.case_started_at does not exist [42703].');
  });
  it('includes a hint when present and handles Error instances and empty errors', () => {
    expect(describeAnalyticsLoadError({ message: 'boom', code: 'X1', hint: 'try later' })).toBe('Analytics could not be loaded: boom [X1]. Hint: try later');
    expect(describeAnalyticsLoadError(new Error('Failed to fetch'))).toContain('Failed to fetch');
    expect(describeAnalyticsLoadError(undefined)).toMatch(/no error detail/);
  });
});
