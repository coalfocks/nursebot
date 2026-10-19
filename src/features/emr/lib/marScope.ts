export type MarScopeIdentity = {
  patientId: string;
  roomId: number | null | undefined;
  assignmentId: string | null;
  caseVersion: string | null;
  actorId: string;
};

export const marScopeKey = (scope: MarScopeIdentity) => [
  scope.patientId,
  scope.roomId ?? 'none',
  scope.assignmentId ?? 'baseline',
  scope.caseVersion ?? 'unversioned',
  scope.actorId,
].join(':');

export const sameMarScope = (a: MarScopeIdentity, b: MarScopeIdentity) => marScopeKey(a) === marScopeKey(b);
