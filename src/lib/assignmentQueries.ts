const ASSIGNMENT_LIST_SELECT = `
    *,
    student:student_id (
      id,
      full_name,
      study_year,
      email,
      school_id,
      specialization_interest
    ),
    room:room_id (
      id,
      room_number,
      specialty_id,
      difficulty_level,
      school_id
    )
  `;

type AssignmentQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        eq: (column: string, value: string | boolean) => unknown;
        then: PromiseLike<unknown>['then'];
      };
      eq: (column: string, value: string | boolean) => unknown;
      then: PromiseLike<unknown>['then'];
    };
  };
};

export function buildAssignmentListQuery(
  client: AssignmentQueryClient,
  scopedSchoolId: string | null,
) {
  let query = client
    .from('student_room_assignments')
    .select(ASSIGNMENT_LIST_SELECT)
    .eq('is_sandbox', false)
    .order('created_at', { ascending: false });

  if (scopedSchoolId) {
    query = query.eq('school_id', scopedSchoolId) as typeof query;
  }

  return query;
}
