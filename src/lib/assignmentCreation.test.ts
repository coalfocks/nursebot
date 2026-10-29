import { describe, expect, it } from 'vitest';
import { materializationRpcArgs, testUserAssignmentInsert } from './assignmentCreation';

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
});
