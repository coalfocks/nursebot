import { describe, expect, it } from 'vitest';
import { filterEligibleAssignmentStudents, getEligibleAssignmentStudents } from './assignmentStudentEligibility';

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

  it('searches exact name or email without reintroducing an account-age cutoff', () => {
    const students = filterEligibleAssignmentStudents([
      { id: 'ua-test', role: 'student', school_id: 'uofa', full_name: 'U of A Test', email: 'uatest@example.test', created_at: '2026-03-30' },
      { id: 'newer', role: 'student', school_id: 'uofa', full_name: 'New Learner', email: 'new@example.test', created_at: '2026-10-01' },
    ], 'uofa', 'uatest@example.test', { mode: 'all' });

    expect(students.map(({ id }) => id)).toEqual(['ua-test']);
  });

  it('supports both school scopes and Clear returning the older learner', () => {
    const profiles = [
      { id: 'ua-test', role: 'student', school_id: 'uofa', full_name: 'U of A Test', email: 'ua@test', created_at: '2026-03-30' },
      { id: 'other', role: 'student', school_id: 'other', full_name: 'Other Learner', email: 'other@test', created_at: '2026-10-01' },
    ];
    expect(filterEligibleAssignmentStudents(profiles, 'uofa', '', { mode: 'academic_year', startYear: 2026 })).toEqual([]);
    expect(filterEligibleAssignmentStudents(profiles, null, '', { mode: 'all' }).map(({ id }) => id)).toEqual(['ua-test', 'other']);
  });
});
