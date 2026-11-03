import { describe, expect, it } from 'vitest';
import type { LabResult } from './types';
import { datetimeLocalToUtc, formatLabColumnLabel } from './labDisplayTime';

const lab = (time: string, scope: LabResult['overrideScope']): LabResult => ({
  id: `${time}-${scope}`, patientId: 'p1', overrideScope: scope, testName: 'Glucose', value: 100,
  unit: 'mg/dL', referenceRange: '70-110', status: 'Normal', collectionTime: time, resultTime: time, orderedBy: 'Test',
});

describe('lab display time', () => {
  it('does not label baseline-only results Now', () => {
    expect(formatLabColumnLabel('2026-11-03T10:00:00.000Z', [lab('2026-11-03T10:00:00.000Z', 'baseline')])).toContain('Baseline');
  });
  it('keeps baseline labels stable when a runtime result arrives', () => {
    const baseline = '2026-11-03T10:00:00.000Z';
    const runtime = '2026-11-03T12:00:00.000Z';
    const labs = [lab(baseline, 'baseline'), lab(runtime, 'assignment')];
    expect(formatLabColumnLabel(baseline, labs)).toBe('Baseline · 2h prior');
    expect(formatLabColumnLabel(runtime, labs)).toBe('Now');
  });
  it('does not apply the local timezone to authored datetime-local values', () => {
    expect(datetimeLocalToUtc('2026-11-03T10:00')).toBe('2026-11-03T10:00:00.000Z');
  });
});
