import { describe, expect, it } from 'vitest';
import { authoredMarCaseVersion, materializationRequestForAssignment } from './marMaterialization';

describe('normal MAR materialization identity', () => {
  it('uses an immutable room-authored version and stable assignment request payload', () => {
    expect(authoredMarCaseVersion(105)).toBe('room-105-mar-v1');
    expect(materializationRequestForAssignment('request-1', {
      id: 'assignment-1', student_id: 'student-1', room_id: 105, school_id: 'school-1',
      case_key_version: 'room-105-mar-v1', effective_date: null, window_start: null, window_end: null,
    })).toMatchObject({ requestId: 'request-1', assignmentId: 'assignment-1', caseVersion: 'room-105-mar-v1' });
  });
});
