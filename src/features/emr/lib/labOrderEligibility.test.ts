import { describe, expect, it } from 'vitest';
import { isResultProducingLab, isResultProducingStatLab } from './labOrderEligibility';

describe('isResultProducingStatLab', () => {
  it('keeps a completed STAT CBC eligible for result materialization', () => {
    expect(isResultProducingStatLab({ category: 'Lab', priority: 'STAT', status: 'Completed', orderName: 'CBC' })).toBe(true);
  });

  it('does not materialize routine, non-lab, or non-instant orders', () => {
    expect(isResultProducingStatLab({ category: 'Lab', priority: 'Routine', status: 'Active', orderName: 'CBC' })).toBe(false);
    expect(isResultProducingStatLab({ category: 'Medication', priority: 'STAT', status: 'Completed', orderName: 'CBC' })).toBe(false);
    expect(isResultProducingStatLab({ category: 'Lab', priority: 'STAT', status: 'Completed', orderName: 'Special send-out' })).toBe(false);
  });

  it('materializes instant BMP/CBC/CMP regardless of priority while leaving pending labs pending', () => {
    for (const orderName of ['Basic Metabolic Panel', 'CBC', 'Comprehensive Metabolic Panel']) {
      expect(isResultProducingLab({ category: 'Lab', orderName })).toBe(true);
    }
    expect(isResultProducingLab({ category: 'Lab', orderName: 'Blood Culture x2 (Peripheral)' })).toBe(false);
  });
});
