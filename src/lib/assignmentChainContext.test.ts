import { describe, expect, it } from 'vitest';
import { buildPriorStageContext, type AssignmentChainNode } from './assignmentChainContext';

const node = (overrides: Partial<AssignmentChainNode>): AssignmentChainNode => ({
  assignmentId: 'assignment',
  chainId: 'chain-1',
  stage: 'A',
  status: 'completed',
  completedAt: '2026-11-03T00:00:00Z',
  studentProgressNote: 'stage note',
  ...overrides,
});

describe('buildPriorStageContext', () => {
  it('returns cumulative completed predecessor notes with immutable provenance', () => {
    const result = buildPriorStageContext({ chainId: 'chain-1', stage: 'C' }, [
      node({ assignmentId: 'b', stage: 'B', studentProgressNote: 'B note' }),
      node({ assignmentId: 'a', stage: 'A', studentProgressNote: 'A note' }),
    ]);
    expect(result).toEqual([
      { sourceAssignmentId: 'a', sourceStage: 'A', completedAt: '2026-11-03T00:00:00Z', content: 'A note' },
      { sourceAssignmentId: 'b', sourceStage: 'B', completedAt: '2026-11-03T00:00:00Z', content: 'B note' },
    ]);
  });

  it('excludes current, future, incomplete, unrelated, and empty notes', () => {
    const result = buildPriorStageContext({ chainId: 'chain-1', stage: 'B' }, [
      node({ assignmentId: 'a', stage: 'A', studentProgressNote: 'A note' }),
      node({ assignmentId: 'c', stage: 'C', studentProgressNote: 'future' }),
      node({ assignmentId: 'other', chainId: 'chain-2', studentProgressNote: 'unrelated' }),
      node({ assignmentId: 'incomplete', stage: 'A', status: 'in_progress' }),
      node({ assignmentId: 'empty', stage: 'A', studentProgressNote: '  ' }),
    ]);
    expect(result.map((item) => item.sourceAssignmentId)).toEqual(['a']);
  });
});
