import { describe, expect, it } from 'vitest';
import { buildPriorStageContext, type AssignmentChainNode } from './assignmentChainContext';

const node = (overrides: Partial<AssignmentChainNode>): AssignmentChainNode => ({
  assignmentId: 'assignment',
  sourceRoomId: 36,
  chainId: 'chain-1',
  stage: 'A',
  status: 'completed',
  completedAt: '2026-11-03T00:00:00Z',
  authoredProgressNote: 'stage note',
  ...overrides,
});

describe('buildPriorStageContext', () => {
  it('returns cumulative completed predecessor notes with immutable provenance', () => {
    const result = buildPriorStageContext({ assignmentId: 'c', chainId: 'chain-1', stage: 'C' }, [
      node({ assignmentId: 'b', sourceRoomId: 37, stage: 'B', authoredProgressNote: 'B note' }),
      node({ assignmentId: 'a', authoredProgressNote: 'A note' }),
    ], '2026-11-03T01:00:00Z');
    expect(result).toEqual([
      { chainId: 'chain-1', targetAssignmentStage: 'C', sourceAssignmentId: 'a', sourceRoomId: 36, sourceStage: 'A', completedAt: '2026-11-03T00:00:00Z', capturedAt: '2026-11-03T01:00:00Z', content: 'A note' },
      { chainId: 'chain-1', targetAssignmentStage: 'C', sourceAssignmentId: 'b', sourceRoomId: 37, sourceStage: 'B', completedAt: '2026-11-03T00:00:00Z', capturedAt: '2026-11-03T01:00:00Z', content: 'B note' },
    ]);
  });

  it('excludes current, future, incomplete, unrelated, and empty notes', () => {
    const result = buildPriorStageContext({ assignmentId: 'b', chainId: 'chain-1', stage: 'B' }, [
      node({ assignmentId: 'a', stage: 'A', authoredProgressNote: 'A note' }),
      node({ assignmentId: 'c', stage: 'C', authoredProgressNote: 'future' }),
      node({ assignmentId: 'other', chainId: 'chain-2', authoredProgressNote: 'unrelated' }),
      node({ assignmentId: 'incomplete', stage: 'A', status: 'in_progress' }),
      node({ assignmentId: 'empty', stage: 'A', authoredProgressNote: '  ' }),
      node({ assignmentId: 'learner-note', stage: 'A', authoredProgressNote: null }),
    ], '2026-11-03T01:00:00Z');
    expect(result.map((item) => item.sourceAssignmentId)).toEqual(['a']);
  });
});
