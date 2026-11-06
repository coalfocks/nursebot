import { describe, expect, it } from 'vitest';
import { buildLabDisplayColumns } from './labDisplayTime';
import type { LabResult } from './types';

const lab = (id: string, testName: string, collectionTime: string, overrideScope: LabResult['overrideScope'] = 'assignment'): LabResult => ({
  id,
  patientId: 'patient-1',
  assignmentId: 'assignment-1',
  roomId: 1,
  overrideScope,
  testName,
  value: 1,
  unit: 'u',
  referenceRange: '0-2',
  status: 'Normal',
  collectionTime,
  resultTime: collectionTime,
  orderedBy: 'Student',
});

describe('student lab display columns', () => {
  it('groups different runtime orders into one column and repeats into the next', () => {
    const grouped = buildLabDisplayColumns([
      lab('bmp-sodium', 'Sodium', '2026-11-03T20:00:00.000Z'),
      lab('cbc-wbc', 'White Blood Cell Count', '2026-11-03T20:01:00.000Z'),
      lab('repeat-sodium', 'Sodium', '2026-11-03T20:05:00.000Z'),
    ]);

    expect(grouped.columns.map((column) => column.key)).toEqual(['runtime:0', 'runtime:1']);
    expect(grouped.keyByLabId.get('bmp-sodium')).toBe('runtime:0');
    expect(grouped.keyByLabId.get('cbc-wbc')).toBe('runtime:0');
    expect(grouped.keyByLabId.get('repeat-sodium')).toBe('runtime:1');
  });

  it('keeps independent baseline sets separate from runtime columns', () => {
    const grouped = buildLabDisplayColumns([
      { ...lab('baseline-a', 'Sodium', '2000-01-01T00:00:00.000Z', 'baseline'), baselineSetId: 'set-a' },
      { ...lab('baseline-b', 'Sodium', '2000-01-01T00:00:00.000Z', 'baseline'), baselineSetId: 'set-b' },
      lab('runtime-a', 'Sodium', '2026-11-03T20:00:00.000Z'),
    ]);

    expect(grouped.columns.map((column) => column.key)).toEqual(['baseline:set-a', 'baseline:set-b', 'runtime:0']);
  });
});
