type StudentProfile = {
  id: string;
  role: string;
  school_id: string | null;
  full_name?: string;
  email?: string | null;
  created_at?: string | null;
};

import { matchesStudentDateFilter, type StudentDateFilter } from './studentVisibility';

/**
 * Student assignment eligibility is governed by role and school scope.
 * Account age is intentionally not part of eligibility: older active learners
 * must remain assignable for reassignment and QA runs.
 */
export function getEligibleAssignmentStudents<T extends StudentProfile>(
  profiles: T[],
  scopedSchoolId: string | null,
) {
  return profiles.filter((profile) => (
    profile.role === 'student' &&
    (!scopedSchoolId || profile.school_id === scopedSchoolId)
  ));
}

export function filterEligibleAssignmentStudents<T extends StudentProfile>(
  profiles: T[],
  scopedSchoolId: string | null,
  searchTerm: string,
  dateFilter: StudentDateFilter,
) {
  const term = searchTerm.trim().toLowerCase();
  return getEligibleAssignmentStudents(profiles, scopedSchoolId).filter((profile) => {
    const matchesSearch = !term ||
      (profile.full_name?.toLowerCase().includes(term) ?? false) ||
      (profile.email?.toLowerCase().includes(term) ?? false);
    return matchesSearch && matchesStudentDateFilter(profile, dateFilter);
  });
}
