export type AssignmentCreateRow = {
  id: string;
  student_id: string;
  room_id: number;
  assigned_by: string;
  status: 'assigned';
  effective_date: string | null;
  window_start: string | null;
  window_end: string | null;
  school_id: string;
  /** Immutable MAR case version materialized with this new assignment. */
  case_key_version: string;
};

export type PendingAssignmentCreate = {
  requestId: string;
  assignments: AssignmentCreateRow[];
  /** Explicit one-case QA escape hatch while normal MAR materialization is unavailable. */
  creationMode?: 'normal' | 'disposable_qa';
};

/**
 * Split a retry into rows that still need insertion. Row IDs are generated
 * before the first request and are the durable idempotency key; never rebuild
 * rows from the editable form after an unknown outcome.
 */
export function getMissingAssignmentRows(
  assignments: AssignmentCreateRow[],
  existingIds: ReadonlySet<string>,
): AssignmentCreateRow[] {
  return assignments.filter((assignment) => !existingIds.has(assignment.id));
}
