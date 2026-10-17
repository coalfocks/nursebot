import { describe, expect, it } from 'vitest';
import { getMissingAssignmentRows, type AssignmentCreateRow } from './assignmentCreation';

const row = (id: string): AssignmentCreateRow => ({
  id,
  student_id: 'synthetic-student',
  room_id: 105,
  assigned_by: 'admin',
  status: 'assigned',
  effective_date: '2026-10-17T01:00:00.000Z',
  window_start: '2026-10-17T00:00:00.000Z',
  window_end: '2026-10-17T00:20:00.000Z',
  school_id: 'synthetic-school',
});

describe('assignment creation idempotency', () => {
  it('retries only missing rows using the original stable IDs', () => {
    const original = [row('request-row-1'), row('request-row-2')];

    expect(getMissingAssignmentRows(original, new Set(['request-row-1']))).toEqual([original[1]]);
    expect(getMissingAssignmentRows(original, new Set(['request-row-1', 'request-row-2']))).toEqual([]);
  });

  it('does not create a replacement row when the original row is already readable', () => {
    const original = row('request-row-1');
    const retryRows = getMissingAssignmentRows([original], new Set([original.id]));

    expect(retryRows).toHaveLength(0);
    expect(original.id).toBe('request-row-1');
  });
});
