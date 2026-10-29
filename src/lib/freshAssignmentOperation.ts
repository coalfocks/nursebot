export type FreshAssignmentOperation = {
  assignmentId: string;
  caseVersion: string;
  effectiveDate: string;
  windowStart: string;
};

export const freshAssignmentOperation = (
  caseVersion: string,
  assignmentId = crypto.randomUUID(),
  now = new Date().toISOString(),
): FreshAssignmentOperation => ({ assignmentId, caseVersion, effectiveDate: now, windowStart: now });

export const freshAssignmentRpcArgs = (operation: FreshAssignmentOperation, roomId: number) => ({
  p_assignment_id: operation.assignmentId,
  p_room_id: roomId,
  p_case_version: operation.caseVersion,
  p_effective_date: operation.effectiveDate,
  p_window_start: operation.windowStart,
  p_window_end: null,
});
