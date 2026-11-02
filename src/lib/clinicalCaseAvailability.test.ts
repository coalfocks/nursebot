import { describe, expect, it, vi } from 'vitest';
import {
  buildAuditRows,
  CLINICAL_ROOM_IDS,
  classifyAvailability,
  filterClinicalRooms,
  isRestrictedCandidate,
  updateClinicalAvailability,
} from './clinicalCaseAvailability';

const uuid = '11111111-1111-4111-8111-111111111111';
const room = (id: number, available_school_ids: unknown, updated_at: string | null = '2026-01-01T00:00:00Z') => ({
  id,
  room_number: String(id),
  role: 'Clinical case',
  school_id: uuid,
  available_school_ids,
  updated_at,
});

describe('clinical case availability audit', () => {
  it('keeps only the exact authoritative clinical scope', () => {
    const rows = filterClinicalRooms([
      room(CLINICAL_ROOM_IDS[0], [uuid]),
      room(102, [uuid]),
      room(118, [uuid]),
      room(999, [uuid]),
    ]);

    expect(rows.map((row) => row.id)).toEqual([CLINICAL_ROOM_IDS[0]]);
  });

  it('classifies global, restricted, and malformed values', () => {
    expect(classifyAvailability(null)).toBe('global');
    expect(classifyAvailability([])).toBe('global');
    expect(classifyAvailability([uuid])).toBe('restricted');
    expect(classifyAvailability(['not-a-uuid'])).toBe('malformed');
    expect(classifyAvailability('[]')).toBe('malformed');
  });

  it('materializes missing authoritative rooms without adding out-of-scope rows', () => {
    const rows = buildAuditRows([room(CLINICAL_ROOM_IDS[0], [uuid]), room(102, [uuid])]);
    expect(rows).toHaveLength(CLINICAL_ROOM_IDS.length);
    expect(rows.find((row) => row.id === CLINICAL_ROOM_IDS[0])?.status).toBe('restricted');
    expect(rows.find((row) => row.id === CLINICAL_ROOM_IDS[1])?.status).toBe('missing');
    expect(rows.some((row) => row.id === 102)).toBe(false);
  });

  it('selects restricted rows as candidates only', () => {
    const rows = buildAuditRows([room(43, [uuid]), room(44, []), room(45, ['bad'])]);
    expect(rows.filter(isRestrictedCandidate).map((row) => row.id)).toEqual([43]);
  });

  it('updates only availability with an updated_at concurrency predicate', async () => {
    const calls: unknown[] = [];
    const query = {
      eq: vi.fn((...args) => { calls.push(['eq', ...args]); return query; }),
      is: vi.fn((...args) => { calls.push(['is', ...args]); return query; }),
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { available_school_ids: [], updated_at: 'later' }, error: null }) })),
    };
    const client = { from: vi.fn(() => ({ update: vi.fn((payload) => { calls.push(['update', payload]); return query; }) })) } as never;
    const result = await updateClinicalAvailability(client, buildAuditRows([room(43, [uuid])])[0]);

    expect(result.kind).toBe('success');
    expect(calls).toContainEqual(['update', { available_school_ids: [] }]);
    expect(calls).toContainEqual(['eq', 'id', 43]);
    expect(calls).toContainEqual(['eq', 'updated_at', '2026-01-01T00:00:00Z']);
    expect(calls.some((call) => Array.isArray(call) && call[0] === 'update' && Object.keys(call[1] as object).length !== 1)).toBe(false);
  });

  it('uses is null for a null timestamp and skips global/malformed/missing rows', async () => {
    const query = {
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { available_school_ids: [], updated_at: null }, error: null }) })),
    };
    const update = vi.fn(() => query);
    const client = { from: vi.fn(() => ({ update })) } as never;
    const rows = buildAuditRows([room(43, [uuid], null), room(44, []), room(45, ['bad'])]);

    await updateClinicalAvailability(client, rows.find((row) => row.id === 43)!);
    expect(query.is).toHaveBeenCalledWith('updated_at', null);
    await updateClinicalAvailability(client, rows.find((row) => row.id === 44)!);
    await updateClinicalAvailability(client, rows.find((row) => row.id === 45)!);
    await updateClinicalAvailability(client, rows.find((row) => row.id === 46)!);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('marks no-row updates as conflicts without retrying', async () => {
    const query = {
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    };
    const update = vi.fn(() => query);
    const client = { from: vi.fn(() => ({ update })) } as never;
    const result = await updateClinicalAvailability(client, buildAuditRows([room(43, [uuid])])[0]);

    expect(result).toEqual({ kind: 'conflict', roomId: 43 });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('marks a readback mismatch as an error', async () => {
    const query = {
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { available_school_ids: [uuid], updated_at: 'later' }, error: null }) })),
    };
    const client = { from: vi.fn(() => ({ update: vi.fn(() => query) })) } as never;
    const result = await updateClinicalAvailability(client, buildAuditRows([room(43, [uuid])])[0]);

    expect(result).toEqual({ kind: 'error', roomId: 43, message: 'Readback did not confirm available_school_ids = [].' });
  });
});
