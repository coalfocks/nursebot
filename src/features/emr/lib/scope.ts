export type OverrideScope = 'baseline' | 'room' | 'assignment';
export type RoomLineage = number[];

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
