import { describe, expect, it } from 'vitest';
import type { LabResult } from './types';
import { datetimeLocalToUtc, formatLabColumnLabel } from './labDisplayTime';
import { formatStudentRelativeTime } from './studentDisplayTime';

const lab = (time: string, scope: LabResult['overrideScope'], baselineRelativeOffsetHours?: number): LabResult => ({
  id: `${time}-${scope}`, patientId: 'p1', overrideScope: scope, testName: 'Glucose', value: 100,
  unit: 'mg/dL', referenceRange: '70-110', status: 'Normal', collectionTime: time, resultTime: time, orderedBy: 'Test', baselineRelativeOffsetHours,
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
  it('keeps student baseline labels relative to a stable case clock', () => {
    const baseline = '2026-11-03T00:00:00.000Z';
    const firstRuntime = '2026-11-03T12:00:00.000Z';
    const laterRuntime = '2026-11-03T18:00:00.000Z';
    const labs = [lab(baseline, 'baseline', 12), lab(firstRuntime, 'assignment'), lab(laterRuntime, 'assignment')];
    expect(formatLabColumnLabel(baseline, labs, true, firstRuntime)).toBe('12 hours prior');
    expect(formatLabColumnLabel(laterRuntime, labs, true, firstRuntime)).toBe('Now');
    expect(formatLabColumnLabel(baseline, labs, true, firstRuntime)).not.toContain('Baseline');
  });
  it('never exposes a calendar date in student time labels', () => {
    expect(formatStudentRelativeTime('2026-11-01T00:00:00.000Z', '2026-11-03T00:00:00.000Z')).toBe('2 days prior');
  });
  it('does not turn a legacy baseline timestamp into a huge elapsed-hour claim', () => {
    expect(formatLabColumnLabel('2000-01-01T00:00:00.000Z', [lab('2000-01-01T00:00:00.000Z', 'baseline')], true, '2026-11-03T12:00:00.000Z')).toBe('Time unavailable');
  });
});
