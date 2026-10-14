import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

import { emrApi } from './api';

const noteRow = {
  id: 'legacy-note',
  patient_id: 'patient-1',
  assignment_id: 'assignment-1',
  room_id: 7,
  override_scope: 'assignment',
  note_type: 'Progress',
  title: 'Progress Note',
  content: 'legacy mirror',
  author: 'Student',
  timestamp: '2026-10-19T06:00:00.000Z',
  signed: true,
  deleted_at: null,
  record_version: 1,
  timeline_entry_id: null,
  relative_offset_hours: null,
};

const orderRow = {
  id: 'order-1', patient_id: 'patient-1', assignment_id: 'assignment-1', room_id: 7,
  override_scope: 'assignment', category: 'Lab', order_name: 'CBC', frequency: null,
  route: null, dose: null, priority: 'STAT', status: 'Active', ordered_by: 'Student',
  order_time: '2026-10-19T06:00:00.000Z', scheduled_time: null, instructions: null,
  deleted_at: null, record_version: 1,
};

const chain = (result: { data: unknown; error: unknown }) => {
  const value = {
    select: vi.fn(() => value),
    eq: vi.fn(() => value),
    is: vi.fn(() => value),
    order: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  return value;
};

describe('assignment EMR read-back', () => {
  beforeEach(() => from.mockReset());

  it('projects the canonical completion note with stable identity and completion time', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'clinical_notes') return chain({ data: [noteRow], error: null });
      if (table === 'student_room_assignments') return chain({
        data: {
          id: 'assignment-1', room_id: 7, student_progress_note: 'Canonical completed note',
          completed_at: '2026-10-19T06:10:32.000Z', updated_at: '2026-10-19T06:10:33.000Z',
        },
        error: null,
      });
      return chain({ data: [noteRow], error: null });
    });

    const notes = await emrApi.listClinicalNotes('patient-1', 'assignment-1', 7);

    expect(notes[0]).toMatchObject({
      id: 'progress-note-assignment-1',
      content: 'Canonical completed note',
      timestamp: '2026-10-19T06:10:32.000Z',
      signed: true,
    });
    expect(notes.filter((note) => note.title === 'Progress Note')).toHaveLength(1);
  });

  it('reports a failed order read instead of presenting an empty chart as authoritative', async () => {
    const onError = vi.fn();
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      return chain({ data: null, error: { message: 'timeout' } });
    });

    const orders = await emrApi.listOrders('patient-1', 'assignment-1', 7, onError);

    expect(orders).toEqual([]);
    expect(onError).toHaveBeenCalledWith('Unable to load saved medical orders. Refresh the chart and try again.');
  });

  it('keeps delayed order data scoped to the request result', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      return chain({ data: [orderRow], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7)).resolves.toMatchObject([
      { id: 'order-1', orderName: 'CBC' },
    ]);
  });
});
