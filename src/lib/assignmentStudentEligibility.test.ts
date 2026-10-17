import { describe, expect, it } from 'vitest';
import { getEligibleAssignmentStudents } from './assignmentStudentEligibility';

describe('getEligibleAssignmentStudents', () => {
  it('keeps an older active learner eligible in the selected school', () => {
    const students = getEligibleAssignmentStudents([
      { id: 'ua-test', role: 'student', school_id: 'uofa', created_at: '2026-03-30' },
      { id: 'other-school', role: 'student', school_id: 'other', created_at: '2026-10-01' },
      { id: 'admin', role: 'school_admin', school_id: 'uofa', created_at: '2026-10-01' },
    ], 'uofa');

    expect(students.map(({ id }) => id)).toEqual(['ua-test']);
  });

  it('returns students from all schools only for the all-schools scope', () => {
    const students = getEligibleAssignmentStudents([
      { id: 'ua-test', role: 'student', school_id: 'uofa' },
      { id: 'other-school', role: 'student', school_id: 'other' },
    ], null);

    expect(students.map(({ id }) => id)).toEqual(['ua-test', 'other-school']);
  });
});
