import { describe, expect, it } from 'vitest';
import { manualMarEventDoseLabel } from './manualMar';

describe('manual MAR dose labels', () => {
  it('only calls a nonblank administered amount administered', () => {
    expect(manualMarEventDoseLabel({ orderedDose: '650', administeredDose: '650', unit: 'mg' })).toBe('650 mg administered');
    expect(manualMarEventDoseLabel({ orderedDose: '650', administeredDose: '', unit: 'mg' })).toBe('650 mg ordered; dose undocumented');
    expect(manualMarEventDoseLabel({ orderedDose: null, administeredDose: null, unit: 'mL' })).toBe('Dose undocumented');
    expect(manualMarEventDoseLabel({ orderedDose: null, administeredDose: '   ', unit: 'mL' })).toBe('Dose undocumented');
  });
});
