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

  it('uses a trusted materialization receipt for pinned medication metadata', async () => {
    const editedMutableBaseline = orderRow({ id: 'baseline-med', dose: '20 mg', route: 'PO' });
    const frozen = orderRow({ id: 'baseline-med', dose: '10 mg', route: 'IV' });
    const labOrder = orderRow({ id: 'lab-order', category: 'Lab', order_name: 'CBC', dose: null });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      if (table === 'mar_assignment_materialization_operations') return chain({ data: { assignment_id: 'assignment-1', published_content_hash: 'hash' }, error: null });
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

  it('keeps Orders readable when the optional MAR reader is unavailable', async () => {
    const onError = vi.fn();
    const mutableMedication = orderRow({ id: 'baseline-med', dose: '20 mg' });
    const nonMedication = orderRow({ id: 'lab-order', category: 'Lab', order_name: 'CBC', dose: null });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      if (table === 'mar_assignment_materialization_operations') return chain({ data: { assignment_id: 'assignment-1', published_content_hash: 'hash' }, error: null });
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

  it('does not query assignment metadata for baseline room authoring', async () => {
    const baselineMedication = orderRow({ id: 'baseline-med', dose: '10 mg' });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      return chain({ data: [baselineMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', undefined, 7)).resolves.toMatchObject([{ id: 'baseline-med', dose: '10 mg' }]);
    expect(from).not.toHaveBeenCalledWith('student_room_assignments');
  });

  it('fails closed when receipt or authored-version lookup errors', async () => {
    const onError = vi.fn();
    const mutableMedication = orderRow({ id: 'baseline-med', dose: '20 mg' });
    const ownLearnerMedication = orderRow({ id: 'learner-med', dose: '5 mg', assignment_id: 'assignment-1' });
    const nonMedication = orderRow({ id: 'baseline-lab', category: 'Lab', order_name: 'CBC' });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      if (table === 'mar_assignment_materialization_operations') return chain({ data: null, error: { message: 'receipt unavailable' } });
      return chain({ data: [mutableMedication, ownLearnerMedication, nonMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7, onError)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'learner-med', dose: '5 mg' }),
      expect.objectContaining({ id: 'baseline-lab', orderName: 'CBC' }),
    ]));
    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7, onError)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'baseline-med' })]));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('MAR materialization'));
  });

  it('does not treat authored-version query errors as legacy', async () => {
    const onError = vi.fn();
    const mutableMedication = orderRow({ id: 'baseline-med', dose: '20 mg' });
    const nonMedication = orderRow({ id: 'baseline-lab', category: 'Lab', order_name: 'CBC' });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'room-7-mar-v2' }, error: null });
      if (table === 'mar_assignment_materialization_operations') return chain({ data: null, error: null });
      if (table === 'mar_authored_case_versions') return chain({ data: null, error: { message: 'version unavailable' } });
      return chain({ data: [mutableMedication, nonMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7, onError)).resolves.toEqual([
      expect.objectContaining({ id: 'baseline-lab', orderName: 'CBC' }),
    ]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('authored MAR version'));
  });

  it('does not treat a non-MAR case key as a frozen medication receipt', async () => {
    const legacyMedication = orderRow({ id: 'legacy-med', dose: '20 mg' });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: { case_key_version: 'non-mar-case-v1' }, error: null });
      if (table === 'mar_assignment_materialization_operations') return chain({ data: null, error: null });
      if (table === 'mar_authored_case_versions') return chain({ data: null, error: null });
      return chain({ data: [legacyMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'legacy-assignment', 7)).resolves.toMatchObject([{ id: 'legacy-med' }]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed on assignment metadata errors instead of treating a pinned contract as legacy', async () => {
    const onError = vi.fn();
    const mutableMedication = orderRow({ id: 'baseline-med', dose: '20 mg' });
    const nonMedication = orderRow({ id: 'lab-order', category: 'Lab', order_name: 'CBC', dose: null });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'student_room_assignments') return chain({ data: null, error: { message: 'network' } });
      return chain({ data: [mutableMedication, nonMedication], error: null });
    });

    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7, onError)).resolves.toEqual([
      expect.objectContaining({ id: 'lab-order', category: 'Lab' }),
    ]);
    expect(onError).toHaveBeenCalledWith('Unable to resolve this assignment\'s order contract. Refresh the chart and try again.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads the composite Orders+MAR publication preview contract', async () => {
    rpc.mockResolvedValue({ data: { revision: 2, contentHash: 'hash-v5', orderCount: 2, eventCount: 3 }, error: null });
    await expect(emrApi.getMarPublicationPreview(7)).resolves.toEqual({ revision: 2, contentHash: 'hash-v5', orderCount: 2, eventCount: 3 });
    expect(rpc).toHaveBeenCalledWith('get_mar_publication_preview', { p_room_id: 7 });
  });

  it('normalizes PostgREST-shaped publication errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'MAR_PUBLICATION_CONTENT_CONFLICT', code: 'P0001' } });
    await expect(emrApi.publishMarCaseVersion(7, {
      requestId: '00000000-0000-0000-0000-000000000001', expectedRevision: 0, expectedContentHash: 'hash',
    })).rejects.toEqual({ message: 'MAR_PUBLICATION_CONTENT_CONFLICT', code: 'P0001' });
  });
});
