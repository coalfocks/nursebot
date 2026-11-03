import { describe, expect, it } from 'vitest';
import {
  assertMatchingAssignmentChainEnvelope,
  assignmentChainEnvelopeKey,
  freezeAssignmentChainEnvelope,
  readPriorStageSnapshots,
  type ChainAssignmentSpec,
  type FrozenAssignmentChainEnvelope,
} from './assignmentChainContext';

const specs = (order: string[] = ['a', 'b', 'c']): ChainAssignmentSpec[] => order.map((assignmentId, index) => ({
  assignmentId,
  stage: (['A', 'B', 'C'] as const)[index],
  roomId: 36 + index,
  authoredSourceVersion: `room-v${index + 1}`,
  authoredProgressNote: `${String.fromCharCode(65 + index)} authored note`,
  authoredCapturedAt: `2026-11-03T00:0${index}:00Z`,
}));

const envelope = (order?: string[]): FrozenAssignmentChainEnvelope => freezeAssignmentChainEnvelope({
  chainId: 'chain-1',
  ownerId: 'student-1',
  windowStart: '2026-11-03T00:00:00Z',
  windowEnd: '2026-11-03T01:00:00Z',
  assignments: specs(order),
});

const materialization = (current: FrozenAssignmentChainEnvelope) => ({
  complete: true as const,
  envelopeKey: assignmentChainEnvelopeKey(current),
  assignmentIds: current.assignments.map(({ assignmentId }) => assignmentId),
});

describe('assignment chain envelope', () => {
  it('preserves reordered membership as a different envelope', () => {
    const expected = envelope();
    const reordered = envelope(['b', 'a', 'c']);
    expect(assignmentChainEnvelopeKey(expected)).not.toBe(assignmentChainEnvelopeKey(reordered));
    expect(() => assertMatchingAssignmentChainEnvelope(expected, reordered)).toThrow('CHAIN_ENVELOPE_MISMATCH');
  });

  it('replays the exact ordered envelope after an uncertain response', () => {
    const first = envelope();
    const retry = freezeAssignmentChainEnvelope({
      chainId: first.chainId,
      ownerId: first.ownerId,
      windowStart: first.windowStart,
      windowEnd: first.windowEnd,
      assignments: first.assignments,
    });
    expect(retry).toEqual(first);
    expect(assignmentChainEnvelopeKey(retry)).toBe(assignmentChainEnvelopeKey(first));
  });

  it('matches semantically identical envelopes after object-key reordering', () => {
    const first = envelope();
    const reorderedKeys = freezeAssignmentChainEnvelope({
      windowEnd: first.windowEnd,
      assignments: first.assignments.map((assignment) => ({
        authoredProgressNote: assignment.authoredProgressNote,
        roomId: assignment.roomId,
        authoredCapturedAt: assignment.authoredCapturedAt,
        stage: assignment.stage,
        authoredSourceVersion: assignment.authoredSourceVersion,
        assignmentId: assignment.assignmentId,
      })),
      ownerId: first.ownerId,
      chainId: first.chainId,
      windowStart: first.windowStart,
    });
    expect(assignmentChainEnvelopeKey(reorderedKeys)).toBe(assignmentChainEnvelopeKey(first));
    expect(() => assertMatchingAssignmentChainEnvelope(first, reorderedKeys)).not.toThrow();
  });

  it('deep-freezes authored provenance', () => {
    const current = envelope();
    expect(Object.isFrozen(current.assignments[0])).toBe(true);
    expect(() => {
      (current.assignments[0] as { authoredProgressNote: string }).authoredProgressNote = 'tampered';
    }).toThrow();
  });

  it('can reject a mismatch before a write boundary is reached', () => {
    const expected = envelope();
    expect(() => assertMatchingAssignmentChainEnvelope(expected, envelope(['a', 'c', 'b']))).toThrow('CHAIN_ENVELOPE_MISMATCH');
  });

  it('keeps partial batches hidden, then reveals cumulative completed predecessors', () => {
    const current = envelope();
    const partial = readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: true },
      { assignmentId: 'c', ownerId: 'student-1', status: 'assigned', completedAt: null, active: false },
    ], 'b', 'student-1', materialization(current));
    expect(partial).toEqual({ status: 'visible', snapshots: [expect.objectContaining({ sourceAssignmentId: 'a', content: 'A authored note' })] });

    const blockedC = readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: false },
      { assignmentId: 'c', ownerId: 'student-1', status: 'assigned', completedAt: null, active: true },
    ], 'c', 'student-1', materialization(current));
    expect(blockedC).toEqual({ status: 'hidden', reason: 'PREDECESSOR_NOT_COMPLETED' });

    const completeC = readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:20:00Z', active: false },
      { assignmentId: 'c', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: true },
    ], 'c', 'student-1', materialization(current));
    expect(completeC).toMatchObject({ status: 'visible', snapshots: [
      expect.objectContaining({ sourceAssignmentId: 'a', sourceCompletedAt: '2026-11-03T00:10:00Z' }),
      expect.objectContaining({ sourceAssignmentId: 'b', sourceCompletedAt: '2026-11-03T00:20:00Z' }),
    ] });
  });

  it('blocks inactive targets, wrong owners, and unrelated assignments', () => {
    const current = envelope();
    expect(readPriorStageSnapshots(current, [], 'b', 'student-1', materialization(current))).toEqual({ status: 'hidden', reason: 'MATERIALIZATION_MISMATCH' });
    expect(readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-2', status: 'in_progress', completedAt: null, active: true },
      { assignmentId: 'c', ownerId: 'student-1', status: 'assigned', completedAt: null, active: false },
    ], 'b', 'student-1', materialization(current))).toEqual({ status: 'hidden', reason: 'OWNER_MISMATCH' });
    expect(readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: false },
      { assignmentId: 'c', ownerId: 'student-1', status: 'assigned', completedAt: null, active: false },
    ], 'b', 'student-1', materialization(current))).toEqual({ status: 'hidden', reason: 'TARGET_NOT_ACTIVE' });
    expect(readPriorStageSnapshots(current, [], 'unrelated', 'student-1', materialization(current))).toEqual({ status: 'hidden', reason: 'CHAIN_ENVELOPE_MISMATCH' });
  });

  it('fails closed when a materialized member is missing', () => {
    const current = envelope();
    expect(readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: true },
    ], 'b', 'student-1', materialization(current))).toEqual({ status: 'hidden', reason: 'MATERIALIZATION_MISMATCH' });
  });

  it('fails closed when the writer has not attested complete materialization', () => {
    const current = envelope();
    expect(readPriorStageSnapshots(current, [
      { assignmentId: 'a', ownerId: 'student-1', status: 'completed', completedAt: '2026-11-03T00:10:00Z', active: false },
      { assignmentId: 'b', ownerId: 'student-1', status: 'in_progress', completedAt: null, active: true },
      { assignmentId: 'c', ownerId: 'student-1', status: 'assigned', completedAt: null, active: false },
    ], 'b', 'student-1', { ...materialization(current), complete: false })).toEqual({
      status: 'hidden',
      reason: 'MATERIALIZATION_MISMATCH',
    });
  });
});
