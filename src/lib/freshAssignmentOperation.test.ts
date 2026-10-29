import { describe, expect, it } from 'vitest';
import { freshAssignmentOperation, freshAssignmentRpcArgs } from './freshAssignmentOperation';

describe('fresh test assignment operation', () => {
  it('reuses the exact assignment ID and body after a committed-but-lost response', () => {
    const operation = freshAssignmentOperation('room-204-manual-r3', 'assignment-1', '2026-10-29T17:00:00.000Z');
    expect(freshAssignmentRpcArgs(operation, 204)).toEqual({
      p_assignment_id: 'assignment-1',
      p_room_id: 204,
      p_case_version: 'room-204-manual-r3',
      p_effective_date: '2026-10-29T17:00:00.000Z',
      p_window_start: '2026-10-29T17:00:00.000Z',
      p_window_end: null,
    });
    expect(freshAssignmentRpcArgs(operation, 204)).toEqual(freshAssignmentRpcArgs(operation, 204));
  });
});
