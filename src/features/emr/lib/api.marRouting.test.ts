import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from, rpc } }));

import { emrApi } from './api';

const orderRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'baseline-med', patient_id: 'patient-1', assignment_id: null, room_id: 7, override_scope: 'room',
  category: 'Medication', order_name: 'Medication', frequency: 'q4h', route: 'PO', dose: '20 mg',
  priority: 'Routine', status: 'Active', ordered_by: 'Author', order_time: '2026-10-19T12:00:00Z',
  scheduled_time: null, instructions: null, deleted_at: null, record_version: 1, ...overrides,
});

const chain = (result: { data: unknown; error: unknown }) => {
  const value = {
    select: vi.fn(() => value), eq: vi.fn(() => value), is: vi.fn(() => value), order: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  return value;
};

describe('MAR frozen medication routing', () => {
  beforeEach(() => { from.mockReset(); rpc.mockReset(); });

  it('uses frozen medication metadata for pinned general Orders while retaining non-medication orders', async () => {
    const frozen = orderRow({ id: 'baseline-med', dose: '10 mg', route: 'IV' });
    const editedMutableBaseline = orderRow({ id: 'baseline-med', dose: '20 mg', route: 'PO' });
    const labOrder = orderRow({ id: 'lab-order', category: 'Lab', order_name: 'CBC', dose: null });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      return chain({ data: [editedMutableBaseline, labOrder], error: null });
    });
    rpc.mockResolvedValue({ data: [frozen], error: null });

    const orders = await emrApi.listOrders('patient-1', 'assignment-1', 7);

    expect(orders.find((order) => order.id === 'baseline-med')).toMatchObject({ dose: '10 mg', route: 'IV' });
    expect(orders.find((order) => order.id === 'lab-order')).toMatchObject({ category: 'Lab' });
    expect(rpc).toHaveBeenCalledWith('get_mar_assignment_order_snapshot', { p_assignment_id: 'assignment-1' });
  });

  it('merges a learner medication order into the frozen MAR rows without inventing an administration', async () => {
    rpc.mockResolvedValue({ data: [orderRow({ id: 'authored-med', dose: '10 mg' })], error: null });
    from.mockImplementation(() => chain({ data: [orderRow({ id: 'learner-med', assignment_id: 'assignment-1', room_id: 7, dose: '5 mg' })], error: null }));

    const orders = await emrApi.listMarMedicationOrders('patient-1', 'assignment-1');

    expect(orders.map((order) => order.id)).toEqual(['authored-med', 'learner-med']);
    expect(orders.find((order) => order.id === 'learner-med')).toMatchObject({ assignmentId: 'assignment-1', dose: '5 mg' });
  });

  it('does not hide non-medication Orders or resurrect mutable baseline medication metadata when the frozen reader fails', async () => {
    const onError = vi.fn();
    const mutableMedication = orderRow({ id: 'baseline-med', dose: '20 mg' });
    const nonMedication = orderRow({ id: 'lab-order', category: 'Lab', order_name: 'CBC', dose: null });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      return chain({ data: [mutableMedication, nonMedication], error: null });
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'snapshot unavailable' } });

    const orders = await emrApi.listOrders('patient-1', 'assignment-1', 7, onError);

    expect(orders.map((order) => order.id)).toEqual(['lab-order']);
    expect(onError).toHaveBeenCalledWith('Unable to load the pinned medication orders for this assignment. Refresh the chart and try again.');
  });

  it('keeps legacy assignments on their existing clinical Orders path when no pinned MAR version exists', async () => {
    const legacyMedication = orderRow({ id: 'legacy-med', dose: '10 mg' });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: null }, error: null });
      return chain({ data: [legacyMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'legacy-assignment', 7)).resolves.toMatchObject([{ id: 'legacy-med', dose: '10 mg' }]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
