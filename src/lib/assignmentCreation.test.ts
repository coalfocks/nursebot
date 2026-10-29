import { describe, expect, it } from 'vitest';
import { assignmentOperationKey, materializationRpcArgs, reconcileAssignmentRows, testUserAssignmentInsert, testUserAssignmentRpcArgs } from './assignmentCreation';

describe('fresh assignment MAR materialization envelope', () => {
  it('binds the immutable case version and stable request identity', () => {
    expect(materializationRpcArgs('request-1', {
      id: 'assignment-1', student_id: 'student-1', room_id: 204, assigned_by: 'admin-1', status: 'assigned',
      effective_date: '2026-10-29T16:00:00.000Z', window_start: '2026-10-29T15:30:00.000Z', window_end: '2026-10-29T17:30:00.000Z',
      school_id: 'school-1', case_key_version: 'room-204-mar-v3',
    })).toMatchObject({ p_request_id: 'request-1', p_assignment_id: 'assignment-1', p_case_version: 'room-204-mar-v3' });
  });

  it('marks test-user creations as sandbox attempts without losing the case version', () => {
    expect(testUserAssignmentInsert({
      id: 'assignment-2', student_id: 'student-2', room_id: 304, assigned_by: 'student-2', status: 'assigned',
      effective_date: null, window_start: null, window_end: null, school_id: 'school-1', case_key_version: 'room-304-mar-v1',
    })).toMatchObject({ is_sandbox: true, case_key_version: 'room-304-mar-v1' });
  });

  it('freezes the complete test-user RPC envelope for response-loss reconciliation', () => {
    expect(testUserAssignmentRpcArgs({
      id: 'assignment-3', student_id: 'student-3', room_id: 204, assigned_by: 'student-3', status: 'assigned',
      effective_date: '2026-10-29T16:00:00.000Z', window_start: '2026-10-29T15:30:00.000Z', window_end: null,
      school_id: 'school-1', case_key_version: 'room-204-manual-r1',
    })).toEqual({
      p_assignment_id: 'assignment-3', p_room_id: 204, p_case_version: 'room-204-manual-r1',
      p_effective_date: '2026-10-29T16:00:00.000Z', p_window_start: '2026-10-29T15:30:00.000Z', p_window_end: null,
    });
  });

  it('reconciles a partial commit with the same assignment IDs and frozen envelopes', () => {
    const assignments = [
      { id: 'a', student_id: 's', room_id: 204, assigned_by: 'admin', status: 'assigned' as const, effective_date: '2026-10-29T16:00:00.000Z', window_start: '2026-10-29T15:30:00.000Z', window_end: '2026-10-29T17:30:00.000Z', school_id: 'school', case_key_version: 'v1' },
      { id: 'b', student_id: 's', room_id: 304, assigned_by: 'admin', status: 'assigned' as const, effective_date: '2026-10-29T16:20:00.000Z', window_start: '2026-10-29T15:30:00.000Z', window_end: '2026-10-29T17:30:00.000Z', school_id: 'school', case_key_version: 'v1' },
    ];
    const retry = reconcileAssignmentRows(assignments, new Set(['a']), new Set(['a']));
    expect(retry.ambiguous).toEqual([]);
    expect(retry.toMaterialize.map((row) => row.id)).toEqual(['b', 'a']);
    expect(retry.toMaterialize.map((row) => row.effective_date)).toEqual([
      assignments[1].effective_date,
      assignments[0].effective_date,
    ]);
  });

  it('binds the frozen operation to actor and form inputs', () => {
    const base = { actorId: 'admin-a', schoolId: 'school-a', targetingMode: 'individual' as const, studentId: 'student-a', bulkStudentIds: [], roomIds: ['204'], windowStart: '09:00', windowEnd: '10:00', timezone: 'UTC', bulkTargetSchoolId: '', bulkTargetSpecialty: '' };
    expect(assignmentOperationKey(base)).not.toBe(assignmentOperationKey({ ...base, studentId: 'student-b' }));
    expect(assignmentOperationKey(base)).not.toBe(assignmentOperationKey({ ...base, actorId: 'admin-b' }));
  });
});
