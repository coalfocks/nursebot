import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

import { emrApi } from './api';

describe('student assignment patient scope', () => {
  beforeEach(() => from.mockReset());

  it('reads the patient through the exact student assignment and room', async () => {
    const result = {
      data: {
        id: 'assignment-1',
        room_id: 42,
        room: {
          id: 42,
          room_number: '42',
          patient: {
            id: 'patient-1',
            room_id: 42,
            school_id: null,
            mrn: 'MRN-1',
            first_name: 'Assigned',
            last_name: 'Patient',
            date_of_birth: '1990-01-01',
            gender: 'Other',
            deleted_at: null,
          },
        },
      },
      error: null,
    };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => result),
    };
    from.mockReturnValue(chain);

    const patient = await emrApi.getPatientForStudentAssignment('student-1', 'assignment-1', 42);

    expect(patient?.id).toBe('patient-1');
    expect(chain.eq).toHaveBeenCalledWith('id', 'assignment-1');
    expect(chain.eq).toHaveBeenCalledWith('student_id', 'student-1');
    expect(chain.eq).toHaveBeenCalledWith('room_id', 42);
  });
});
