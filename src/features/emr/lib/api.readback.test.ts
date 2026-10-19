import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { from } }));
import { emrApi } from './api';

const chain = (result: { data: unknown; error: unknown }) => {
  const value = {
    select: vi.fn(() => value), eq: vi.fn(() => value), is: vi.fn(() => value),
    order: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
  };
  return value;
};

describe('completed EMR read-back', () => {
  beforeEach(() => from.mockReset());

  it('projects the canonical completion note with stable ID and completion time', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      if (table === 'clinical_notes') return chain({ data: [], error: null });
      return chain({ data: { room_id: 7, student_progress_note: 'Canonical note', completed_at: '2026-10-19T06:10:32Z', updated_at: '2026-10-19T06:10:33Z' }, error: null });
    });
    const notes = await emrApi.listClinicalNotes('patient-1', 'assignment-1', 7);
    expect(notes[0]).toMatchObject({ id: 'progress-note-assignment-1', content: 'Canonical note', timestamp: '2026-10-19T06:10:32Z', signed: true });
  });

  it('surfaces failed order reads instead of treating an empty result as authoritative', async () => {
    const onError = vi.fn();
    from.mockImplementation((table: string) => table === 'rooms' ? chain({ data: { continues_from: null }, error: null }) : chain({ data: null, error: { message: 'timeout' } }));
    await expect(emrApi.listOrders('patient-1', 'assignment-1', 7, onError)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith('Unable to load saved medical orders. Refresh the chart and try again.');
  });

  it('waits for delayed order reads before returning the authoritative list', async () => {
    let resolveOrders!: (value: { data: unknown; error: unknown }) => void;
    const delayed = new Promise<{ data: unknown; error: unknown }>((resolve) => { resolveOrders = resolve; });
    from.mockImplementation((table: string) => {
      if (table === 'rooms') return chain({ data: { continues_from: null }, error: null });
      const value = chain({ data: null, error: null });
      value.order = vi.fn(() => delayed);
      return value;
    });
    const result = emrApi.listOrders('patient-1', 'assignment-1', 7);
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveOrders({ data: [], error: null });
    await expect(result).resolves.toEqual([]);
  });
});
