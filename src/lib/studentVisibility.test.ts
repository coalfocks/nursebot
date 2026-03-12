import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_STUDENT_LOOKBACK_MONTHS,
  getAssignableStudentCutoffDate,
  isAssignableStudentProfile,
} from './studentVisibility';

describe('studentVisibility', () => {
  it('derives the assignable student cutoff from a rolling six-month lookback', () => {
    const cutoff = getAssignableStudentCutoffDate(new Date('2026-03-12T12:00:00.000Z'));

    expect(ASSIGNABLE_STUDENT_LOOKBACK_MONTHS).toBe(6);
    expect(cutoff.toISOString()).toBe('2025-09-12T12:00:00.000Z');
  });

  it('includes students created on or after the cutoff', () => {
    const now = new Date('2026-03-12T12:00:00.000Z');

    expect(isAssignableStudentProfile({ created_at: '2025-09-12T12:00:00.000Z' }, now)).toBe(true);
    expect(isAssignableStudentProfile({ created_at: '2025-12-01T08:00:00.000Z' }, now)).toBe(true);
  });

  it('excludes students older than the cutoff or with invalid timestamps', () => {
    const now = new Date('2026-03-12T12:00:00.000Z');

    expect(isAssignableStudentProfile({ created_at: '2025-09-12T11:59:59.000Z' }, now)).toBe(false);
    expect(isAssignableStudentProfile({ created_at: null }, now)).toBe(false);
    expect(isAssignableStudentProfile({ created_at: 'not-a-date' }, now)).toBe(false);
  });
});
