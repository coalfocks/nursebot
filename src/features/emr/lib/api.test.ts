import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicalOrder } from './types';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));

import { emrApi } from './api';

const orderRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'server-order-id',
  patient_id: 'patient-1',
  assignment_id: null,
  room_id: 3,
  override_scope: 'room',
  category: 'Medication',
  order_name: 'Aspirin',
  frequency: null,
  route: 'PO',
  dose: '81 mg',
  priority: 'Routine',
  status: 'Active',
  ordered_by: 'Nurse',
  order_time: '2026-10-02T21:00:00.000Z',
  scheduled_time: null,
  instructions: null,
  deleted_at: null,
  record_version: 2,
  ...overrides,
});

const noteRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'server-note-id',
  patient_id: 'patient-1',
  assignment_id: null,
  room_id: 3,
  override_scope: 'room',
  note_type: 'Progress',
  title: 'Persisted note',
  content: 'Persisted content',
  author: 'Nurse',
  timestamp: '2026-10-02T21:00:00.000Z',
  signed: false,
  deleted_at: null,
  record_version: 2,
  ...overrides,
});

const builder = (result: { data: unknown; error: unknown }) => {
  const chain = {
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
};

const draftOrder: MedicalOrder = {
  id: 'optimistic-id',
  patientId: 'patient-1',
  roomId: 3,
  overrideScope: 'room',
  category: 'Medication',
  orderName: 'Aspirin',
  route: 'PO',
  dose: '81 mg',
  priority: 'Routine',
  status: 'Active',
  orderedBy: 'Nurse',
  orderTime: '2026-10-02T21:00:00.000Z',
  recordVersion: 1,
};

describe('emrApi versioned note/order mutations', () => {
  beforeEach(() => from.mockReset());

  it('returns the complete persisted order instead of the optimistic draft', async () => {
    from.mockReturnValue(builder({ data: orderRow(), error: null }));

    const saved = await emrApi.addOrder(draftOrder);

    expect(saved).toMatchObject({ id: 'server-order-id', recordVersion: 2 });
    expect(saved?.id).not.toBe(draftOrder.id);
  });

  it('returns the complete persisted note instead of the optimistic draft', async () => {
    from.mockReturnValue(builder({ data: noteRow(), error: null }));

    const saved = await emrApi.addClinicalNote({
      id: 'optimistic-note-id',
      patientId: 'patient-1',
      roomId: 3,
      overrideScope: 'room',
      type: 'Progress',
      title: 'Draft note',
      content: 'Draft content',
      author: 'Nurse',
      signed: false,
    });

    expect(saved).toMatchObject({ id: 'server-note-id', recordVersion: 2 });
    expect(saved?.id).not.toBe('optimistic-note-id');
  });

  it('returns the current row when compare-and-swap finds a stale version', async () => {
    from
      .mockReturnValueOnce(builder({ data: null, error: null }))
      .mockReturnValueOnce(builder({ data: orderRow({ status: 'Completed', record_version: 4 }), error: null }));

    const result = await emrApi.updateOrder('server-order-id', { status: 'Discontinued' }, 3);

    expect(result).toEqual({
      conflict: true,
      expectedVersion: 3,
      current: expect.objectContaining({ status: 'Completed', recordVersion: 4 }),
    });
  });
});
