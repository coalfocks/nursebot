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
  case_key_version: string;
};

export type AssignmentMaterializationRpcArgs = {
  p_request_id: string;
  p_assignment_id: string;
  p_student_id: string;
  p_room_id: number;
  p_school_id: string;
  p_case_version: string;
  p_effective_date: string | null;
  p_window_start: string | null;
  p_window_end: string | null;
};

export type AssignmentOperationKeyInput = {
  actorId: string;
  schoolId: string | null;
  targetingMode: 'individual' | 'bulk';
  studentId: string;
  bulkStudentIds: string[];
  roomIds: string[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
  bulkTargetSchoolId: string;
  bulkTargetSpecialty: string;
};

export const assignmentOperationKey = (input: AssignmentOperationKeyInput): string => JSON.stringify({
  ...input,
  bulkStudentIds: [...input.bulkStudentIds].sort(),
  roomIds: [...input.roomIds].sort(),
});

export const materializationRpcArgs = (
  requestId: string,
  assignment: AssignmentCreateRow,
): AssignmentMaterializationRpcArgs => ({
  p_request_id: requestId,
  p_assignment_id: assignment.id,
  p_student_id: assignment.student_id,
  p_room_id: assignment.room_id,
  p_school_id: assignment.school_id,
  p_case_version: assignment.case_key_version,
  p_effective_date: assignment.effective_date,
  p_window_start: assignment.window_start,
  p_window_end: assignment.window_end,
});

export const testUserAssignmentInsert = (assignment: AssignmentCreateRow) => ({
  id: assignment.id,
  student_id: assignment.student_id,
  room_id: assignment.room_id,
  assigned_by: assignment.assigned_by,
  status: assignment.status,
  is_sandbox: true,
  school_id: assignment.school_id,
  case_key_version: assignment.case_key_version,
});

export const testUserAssignmentRpcArgs = (assignment: AssignmentCreateRow) => ({
  p_assignment_id: assignment.id,
  p_room_id: assignment.room_id,
  p_case_version: assignment.case_key_version,
  p_effective_date: assignment.effective_date,
  p_window_start: assignment.window_start,
  p_window_end: assignment.window_end,
});

export function getMissingAssignmentRows(
  assignments: AssignmentCreateRow[],
  existingIds: ReadonlySet<string>,
): AssignmentCreateRow[] {
  return assignments.filter((assignment) => !existingIds.has(assignment.id));
}

export function reconcileAssignmentRows(
  assignments: AssignmentCreateRow[],
  existingIds: ReadonlySet<string>,
  materializedIds: ReadonlySet<string>,
): { toMaterialize: AssignmentCreateRow[]; ambiguous: AssignmentCreateRow[] } {
  const missing = getMissingAssignmentRows(assignments, existingIds);
  const ambiguous = assignments.filter((assignment) => existingIds.has(assignment.id) && !materializedIds.has(assignment.id));
  return {
    toMaterialize: [...missing, ...assignments.filter((assignment) => materializedIds.has(assignment.id))],
    ambiguous,
  };
}
