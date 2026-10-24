import { describe, expect, it } from 'vitest';
import { filterHistoricalRows } from './historical-context';

const cutoff = '2026-10-24T12:00:00Z';

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-1', order_time: '2026-10-24T10:00:00Z', created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T09:00:00Z', deleted_at: null, ...overrides,
});

describe('historical context boundaries', () => {
  it('excludes a late-recorded row even when its clinical event is early', () => {
    const result = filterHistoricalRows('medical_orders', [order({ created_at: '2026-10-24T13:00:00Z' })], cutoff);
    expect(result.rows).toEqual([]);
    expect(result.availability.excluded_after_recorded_at).toEqual({ medical_orders: 1 });
  });

  it('does not silently use a current edit when no historical version exists', () => {
    const result = filterHistoricalRows('medical_orders', [order({ updated_at: '2026-10-24T13:00:00Z', order_name: 'edited-later' })], cutoff);
    expect(result.rows).toEqual([]);
    expect(result.availability.missing_historical_version).toEqual([{ table: 'medical_orders', id: 'order-1', recorded_at: '2026-10-24T09:00:00Z', event_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T13:00:00Z', deleted_at: null, reason: 'edited_after_completion' }]);
  });

  it('retains an order deleted after completion and records the deletion boundary', () => {
    const result = filterHistoricalRows('medical_orders', [order({ deleted_at: '2026-10-24T13:00:01Z' })], cutoff);
    expect(result.rows).toHaveLength(1);
    expect(result.availability.retained_deleted_after_cutoff).toEqual([{ table: 'medical_orders', id: 'order-1', recorded_at: '2026-10-24T09:00:00Z', event_at: '2026-10-24T10:00:00Z', deleted_at: '2026-10-24T13:00:01Z' }]);
  });

  it('recovers an imaging version valid at completion', () => {
    const result = filterHistoricalRows('imaging_studies', [{ id: 'study-1', order_time: '2026-10-24T10:00:00Z', created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T13:00:00Z', deleted_at: '2026-10-24T14:00:00Z', report: 'current' }], cutoff, [{ study_id: 'study-1', version: 1, created_at: '2026-10-24T11:00:00Z', encounter_time: '2026-10-24T10:00:00Z', report: 'historical' }]);
    expect(result.rows[0]).toMatchObject({ report: 'historical', __historical_version_recovered: true, deleted_at: null });
    expect(result.availability.recovered_versions).toEqual([{ table: 'imaging_studies', id: 'study-1', version: 1, recorded_at: '2026-10-24T11:00:00Z' }]);
  });
});
