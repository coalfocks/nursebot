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

const readableBuilder = (result: { data: unknown; error: unknown }) => {
  const chain = {
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(() => chain),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
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

  it('reads baseline, room, and active-assignment labs without mixing other sessions', async () => {
    const lab = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'baseline-lab',
      patient_id: 'patient-1',
      assignment_id: null,
      room_id: null,
      override_scope: 'baseline',
      test_name: 'AST',
      value: 1200,
      unit: 'U/L',
      reference_range: '10-40',
      status: 'Critical',
      collection_time: '2000-01-01T00:00:00.000Z',
      result_time: '2000-01-01T00:00:00.000Z',
      ordered_by: 'Admission',
      created_at: null,
      deleted_at: null,
      ...overrides,
    });
    let labQuery = 0;
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return builder({ data: { continues_from: null }, error: null });
      labQuery += 1;
      if (labQuery === 1) return readableBuilder({ data: [lab()], error: null });
      if (labQuery === 2) return readableBuilder({ data: [lab({ id: 'room-lab', room_id: 3, override_scope: 'room', test_name: 'INR', value: 1.8 })], error: null });
      return readableBuilder({ data: [lab({ id: 'active-lab', assignment_id: 'assignment-1', room_id: 3, override_scope: 'assignment', test_name: 'Ammonia', value: 125 })], error: null });
    });

    const labs = await emrApi.listLabResults('patient-1', 'assignment-1', 3);

    expect(labs).toHaveLength(3);
    expect(new Set(labs.map((entry) => entry.id))).toEqual(new Set(['active-lab', 'room-lab', 'baseline-lab']));
  });

  it('persists coded lab values without coercing them to zero or null-only results', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    from.mockReturnValue({ insert });

    await emrApi.addLabResults([
      {
        id: 'coded-lab',
        patientId: 'patient-1',
        assignmentId: 'assignment-1',
        roomId: 3,
        overrideScope: 'assignment',
        testName: 'ABO/Rh',
        value: 'O positive',
        valueType: 'coded',
        unit: '',
        referenceRange: '',
        status: 'Normal',
        collectionTime: '2026-10-02T21:00:00.000Z',
        orderedBy: 'Nurse',
      },
    ], 3);

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ value: null, text_value: 'O positive', value_type: 'coded' }),
    ]);
  });

  it('authorizes a shared-stage assignment even when the room has another primary school', async () => {
    const assignmentQuery = builder({
      data: {
        id: 'assignment-1',
        room_id: 20,
        student_id: 'student-1',
        school_id: 'school-b',
        status: 'in_progress',
        case_key_version: 'room-20-mar-v1',
      },
      error: null,
    });
    const roomQuery = builder({
      data: { id: 20, patient_id: 'patient-20', school_id: 'school-a' },
      error: null,
    });
    from.mockReturnValueOnce(assignmentQuery).mockReturnValueOnce(roomQuery);

    const scope = await emrApi.getMarAssignmentContext(
      'assignment-1',
      'school-admin-1',
      'school_admin',
      'school-b',
      20,
    );

    expect(scope).toMatchObject({
      assignmentId: 'assignment-1',
      roomId: 20,
      patientId: 'patient-20',
      schoolId: 'school-b',
      caseVersion: 'room-20-mar-v1',
    });
    expect(assignmentQuery.eq).toHaveBeenCalledWith('school_id', 'school-b');
  });

  it('does not reinterpret a legacy scenario version as an MAR snapshot key', async () => {
    from
      .mockReturnValueOnce(builder({
        data: {
          id: 'assignment-old',
          room_id: 20,
          student_id: 'student-1',
          school_id: 'school-b',
          status: 'completed',
          case_key_version: null,
          scenario_baseline_version: 6,
        },
        error: null,
      }))
      .mockReturnValueOnce(builder({
        data: { id: 20, patient_id: 'patient-20', school_id: 'school-a' },
        error: null,
      }));

    const scope = await emrApi.getMarAssignmentContext(
      'assignment-old',
      'student-1',
      'student',
      'school-b',
      20,
    );

    expect(scope?.caseVersion).toBeNull();
  });
});
