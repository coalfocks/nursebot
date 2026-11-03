export type ChainStage = 'A' | 'B' | 'C';

export type ChainAssignmentSpec = {
  assignmentId: string;
  stage: ChainStage;
  roomId: number;
  authoredSourceVersion: string;
  authoredProgressNote: string | null;
  authoredCapturedAt: string;
};

export type FrozenAssignmentChainEnvelope = {
  version: 1;
  chainId: string;
  ownerId: string;
  windowStart: string;
  windowEnd: string;
  assignments: [ChainAssignmentSpec, ChainAssignmentSpec, ChainAssignmentSpec];
};

export type ChainAssignmentState = {
  assignmentId: string;
  ownerId: string;
  status: 'assigned' | 'in_progress' | 'bedside' | 'completed';
  completedAt: string | null;
  active: boolean;
};

export type PriorStageSnapshot = {
  chainId: string;
  targetAssignmentId: string;
  targetStage: ChainStage;
  sourceAssignmentId: string;
  sourceRoomId: number;
  sourceStage: ChainStage;
  authoredSourceVersion: string;
  authoredCapturedAt: string;
  sourceCompletedAt: string;
  content: string;
};

export type ChainVisibilityResult =
  | { status: 'visible'; snapshots: PriorStageSnapshot[] }
  | { status: 'hidden'; reason: 'CHAIN_ENVELOPE_MISMATCH' | 'OWNER_MISMATCH' | 'TARGET_NOT_ACTIVE' | 'PREDECESSOR_NOT_COMPLETED' };

const orderedStages: ChainStage[] = ['A', 'B', 'C'];

const requireText = (value: string, field: string) => {
  if (!value.trim()) throw new Error(`CHAIN_ENVELOPE_INVALID:${field}`);
  return value;
};

/**
 * Freezes the selected-room order and authored source at assignment creation
 * time. The caller supplies IDs/timestamps; this function never generates
 * identifiers or reads live rooms, so retries can reuse the exact envelope.
 */
export const freezeAssignmentChainEnvelope = (input: {
  chainId: string;
  ownerId: string;
  windowStart: string;
  windowEnd: string;
  assignments: ChainAssignmentSpec[];
}): FrozenAssignmentChainEnvelope => {
  requireText(input.chainId, 'chainId');
  requireText(input.ownerId, 'ownerId');
  if (input.assignments.length !== orderedStages.length) throw new Error('CHAIN_ENVELOPE_INVALID:assignments');
  const assignments = input.assignments.map((assignment, index) => {
    requireText(assignment.assignmentId, `assignments[${index}].assignmentId`);
    requireText(assignment.authoredSourceVersion, `assignments[${index}].authoredSourceVersion`);
    requireText(assignment.authoredCapturedAt, `assignments[${index}].authoredCapturedAt`);
    if (assignment.stage !== orderedStages[index]) throw new Error('CHAIN_ENVELOPE_INVALID:stage_order');
    if (assignment.authoredProgressNote != null && !assignment.authoredProgressNote.trim()) {
      throw new Error(`CHAIN_ENVELOPE_INVALID:assignments[${index}].authoredProgressNote`);
    }
    return { ...assignment };
  }) as FrozenAssignmentChainEnvelope['assignments'];
  if (new Set(assignments.map((assignment) => assignment.assignmentId)).size !== assignments.length) {
    throw new Error('CHAIN_ENVELOPE_INVALID:duplicate_assignment_id');
  }
  return {
    version: 1,
    chainId: input.chainId,
    ownerId: input.ownerId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    assignments,
  };
};

/** Stable comparison key. Array order is intentionally preserved. */
export const assignmentChainEnvelopeKey = (envelope: FrozenAssignmentChainEnvelope): string => JSON.stringify(envelope);

export const assertMatchingAssignmentChainEnvelope = (
  expected: FrozenAssignmentChainEnvelope,
  actual: FrozenAssignmentChainEnvelope,
) => {
  if (assignmentChainEnvelopeKey(expected) !== assignmentChainEnvelopeKey(actual)) {
    throw new Error('CHAIN_ENVELOPE_MISMATCH');
  }
};

const stageIndex = (stage: ChainStage) => orderedStages.indexOf(stage);

/**
 * Candidate reader gate. It returns no content until the target is active,
 * the viewer owns the chain, and every preceding stage is completed. It never
 * reads learner completion text or any live/current/future room content.
 */
export const readPriorStageSnapshots = (
  envelope: FrozenAssignmentChainEnvelope,
  states: ChainAssignmentState[],
  targetAssignmentId: string,
  viewerId: string,
): ChainVisibilityResult => {
  const targetIndex = envelope.assignments.findIndex((assignment) => assignment.assignmentId === targetAssignmentId);
  if (targetIndex < 0) return { status: 'hidden', reason: 'CHAIN_ENVELOPE_MISMATCH' };
  const byId = new Map(states.map((state) => [state.assignmentId, state]));
  const target = byId.get(targetAssignmentId);
  if (!target || target.ownerId !== viewerId || envelope.ownerId !== viewerId) {
    return { status: 'hidden', reason: 'OWNER_MISMATCH' };
  }
  if (!target.active) return { status: 'hidden', reason: 'TARGET_NOT_ACTIVE' };

  const priorAssignments = envelope.assignments.slice(0, targetIndex);
  const priorStates = priorAssignments.map((assignment) => byId.get(assignment.assignmentId));
  if (priorStates.some((state) => !state || state.ownerId !== viewerId || state.status !== 'completed' || !state.completedAt)) {
    return { status: 'hidden', reason: 'PREDECESSOR_NOT_COMPLETED' };
  }

  return {
    status: 'visible',
    snapshots: priorAssignments.map((assignment, index) => ({
      chainId: envelope.chainId,
      targetAssignmentId,
      targetStage: envelope.assignments[targetIndex].stage,
      sourceAssignmentId: assignment.assignmentId,
      sourceRoomId: assignment.roomId,
      sourceStage: assignment.stage,
      authoredSourceVersion: assignment.authoredSourceVersion,
      authoredCapturedAt: assignment.authoredCapturedAt,
      sourceCompletedAt: priorStates[index]!.completedAt as string,
      content: assignment.authoredProgressNote?.trim() ?? '',
    })),
  };
};

export const assertValidChainEnvelopeTarget = (envelope: FrozenAssignmentChainEnvelope, targetAssignmentId: string) => {
  const target = envelope.assignments.find((assignment) => assignment.assignmentId === targetAssignmentId);
  if (!target || stageIndex(target.stage) < 0) throw new Error('CHAIN_ENVELOPE_MISMATCH');
  return target;
};
