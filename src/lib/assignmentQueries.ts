import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

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
      school_id,
      case_goals
    )
  `;

export const ASSIGNMENT_LIST_PAGE_SIZE = 1000;

type AssignmentListClient = SupabaseClient<Database>;

/**
 * Build the admin assignment query while retaining the existing school scope.
 * The ID tie-breaker makes the ordering stable across paginated requests when
 * assignments share a created_at value.
 */
export function buildAssignmentListQuery(
  client: AssignmentListClient,
  scopedSchoolId: string | null,
) {
  let query = client
    .from('student_room_assignments')
    .select(ASSIGNMENT_LIST_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (scopedSchoolId) {
    query = query.eq('school_id', scopedSchoolId);
  }

  return query;
}

/**
 * Supabase's REST gateway caps a response at 1,000 rows. Fetch the Case
 * Assignments list in bounded pages so records 1,001–2,000 (and any later
 * records) are available to the existing client-side filters and table without
 * changing authorization or silently truncating a larger school.
 */
export async function fetchAssignmentList(
  client: AssignmentListClient,
  scopedSchoolId: string | null,
) {
  const rows: unknown[] = [];

  for (let from = 0; ; from += ASSIGNMENT_LIST_PAGE_SIZE) {
    const to = from + ASSIGNMENT_LIST_PAGE_SIZE - 1;
    const { data, error } = await buildAssignmentListQuery(client, scopedSchoolId)
      .range(from, to);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }

  return rows;
}
