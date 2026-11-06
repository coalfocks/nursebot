/** Stable authored version identity for a new assignment's room snapshot. */
export const authoredMarCaseVersion = (roomId: number, authoredVersion = 1) =>
  `room-${roomId}-mar-v${authoredVersion}`;

export type MarMaterializationRequest = {
  requestId: string;
  assignmentId: string;
  studentId: string;
  roomId: number;
  schoolId: string;
  caseVersion: string;
  effectiveDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export const materializationRequestForAssignment = (
  requestId: string,
  assignment: {
    id: string;
    student_id: string;
    room_id: number;
    school_id: string;
    case_key_version: string;
    effective_date: string | null;
    window_start: string | null;
    window_end: string | null;
  },
): MarMaterializationRequest => ({
  requestId,
  assignmentId: assignment.id,
  studentId: assignment.student_id,
  roomId: assignment.room_id,
  schoolId: assignment.school_id,
  caseVersion: assignment.case_key_version,
  effectiveDate: assignment.effective_date,
  windowStart: assignment.window_start,
  windowEnd: assignment.window_end,
});
