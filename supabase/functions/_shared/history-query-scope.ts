export type OptionalHistoryScope =
  | { kind: 'assignment'; assignment_id: string }
  | { kind: 'room'; room_id: number; case_version: string | null; case_version_status: 'exact' | 'unknown_unmatched' };

export const optionalHistoryScope = (table: string, assignmentId: string, roomId: number, caseVersion: string | null): OptionalHistoryScope => {
  if (table !== 'manual_mar_packet_audit') return { kind: 'assignment', assignment_id: assignmentId };
  const normalizedVersion = typeof caseVersion === 'string' && caseVersion.trim() ? caseVersion.trim() : null;
  return {
    kind: 'room',
    room_id: roomId,
    case_version: normalizedVersion,
    case_version_status: normalizedVersion ? 'exact' : 'unknown_unmatched',
  };
};
