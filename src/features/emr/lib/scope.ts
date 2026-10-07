export type OverrideScope = 'baseline' | 'room' | 'assignment';
export type RoomLineage = number[];

export type ScopeIdentity = {
  patientId: string | null | undefined;
  roomId?: number | null;
  assignmentId?: string | null;
  overrideScope?: string | null;
  expectedPatientId?: string | null;
  expectedRoomId?: number | null;
  expectedAssignmentId?: string | null;
};

export type ScopeValidation = { ok: true; scope: OverrideScope } | { ok: false; error: string };

/** Pure client-side guard; database triggers remain authoritative. */
export const validateScopeIdentity = (input: ScopeIdentity): ScopeValidation => {
  const scope = resolveOverrideScope(input.overrideScope, input.assignmentId, input.roomId);
  if (!input.patientId) return { ok: false, error: 'A patient is required for an EMR write.' };
  if (input.expectedPatientId && input.patientId !== input.expectedPatientId) {
    return { ok: false, error: 'The EMR patient does not match the active patient.' };
  }
  if (input.expectedRoomId != null && input.roomId !== input.expectedRoomId) {
    return { ok: false, error: 'The EMR room does not match the active room.' };
  }
  if (input.expectedAssignmentId && input.assignmentId !== input.expectedAssignmentId) {
    return { ok: false, error: 'The EMR assignment does not match the active assignment.' };
  }
  if (scope === 'baseline' && (input.roomId != null || input.assignmentId != null)) {
    return { ok: false, error: 'Baseline records cannot include room or assignment scope.' };
  }
  if (scope === 'room' && (input.roomId == null || input.assignmentId != null)) {
    return { ok: false, error: 'Room records require a room and cannot include an assignment.' };
  }
  if (scope === 'assignment' && (input.roomId == null || input.assignmentId == null)) {
    return { ok: false, error: 'Assignment records require both room and assignment scope.' };
  }
  return { ok: true, scope };
};

export const resolveOverrideScope = (
  overrideScope: string | null | undefined,
  assignmentId?: string | null,
  roomId?: number | null,
): OverrideScope => {
  if (overrideScope === 'assignment' || overrideScope === 'room' || overrideScope === 'baseline') {
    return overrideScope;
  }
  if (assignmentId) return 'assignment';
  if (roomId) return 'room';
  return 'baseline';
};

/**
 * Determines which independently stored record scopes can be displayed in a
 * given EMR context. It never changes or merges persisted records.
 */
export const scopeMatchesContext = (
  scope: OverrideScope,
  rowRoomId: number | null,
  targetRoomIds?: RoomLineage | null,
  rowAssignmentId?: string | null,
  targetAssignmentId?: string | null,
): boolean => {
  if (scope === 'assignment') {
    return Boolean(targetAssignmentId && rowAssignmentId === targetAssignmentId);
  }
  if (scope === 'room') {
    return Boolean(targetRoomIds?.length && targetRoomIds.includes(rowRoomId ?? -1));
  }
  return true;
};
