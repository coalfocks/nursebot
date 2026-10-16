type StudentProfile = {
  id: string;
  role: string;
  school_id: string | null;
};

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
