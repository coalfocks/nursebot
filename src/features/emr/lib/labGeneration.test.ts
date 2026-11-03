import { describe, expect, it } from 'vitest';
import { isInstantLab, isPendingLab, shouldGenerateLabForOrder, validateCompleteLabPanel } from './labGeneration';

describe('live lab generation rules', () => {
  it('generates instant BMP/CBC/CMP for every supported priority, but never pending labs', () => {
    expect(isInstantLab('Basic Metabolic Panel (BMP)')).toBe(true);
    expect(isInstantLab('Complete Blood Count with Differential')).toBe(true);
    expect(isInstantLab('Comprehensive Metabolic Panel (CMP)')).toBe(true);
    expect(isPendingLab('Blood Culture x2 (Peripheral)')).toBe(true);
    expect(shouldGenerateLabForOrder('Basic Metabolic Panel (BMP)', 'Routine')).toBe(true);
    expect(shouldGenerateLabForOrder('Basic Metabolic Panel (BMP)', 'Timed')).toBe(true);
    expect(shouldGenerateLabForOrder('Basic Metabolic Panel (BMP)', 'STAT')).toBe(true);
    expect(shouldGenerateLabForOrder('Blood Culture x2 (Peripheral)', 'STAT')).toBe(false);
  });

  it('rejects incomplete, duplicate, and valueless panels', () => {
    const requested = [{ testName: 'Sodium', unit: 'mmol/L', referenceRange: '135-145' }];
    expect(() => validateCompleteLabPanel(requested, [])).toThrow(/incomplete panel/);
    expect(() => validateCompleteLabPanel(requested, [{ testName: 'Sodium', value: null }])).toThrow(/no value/);
    expect(validateCompleteLabPanel(requested, [{ testName: 'Sodium', value: 140 }])[0]).toMatchObject({ testName: 'Sodium', value: 140 });
  });

  it('accepts safe model analyte aliases while preserving requested panel names', () => {
    const requested = [
      { testName: 'White Blood Cell Count', unit: 'K/uL', referenceRange: '4.0-11.0' },
      { testName: 'CO2 (Bicarbonate)', unit: 'mmol/L', referenceRange: '22-29' },
    ];
    expect(validateCompleteLabPanel(requested, [
      { testName: 'WBC', value: 7.1 },
      { testName: 'Bicarbonate', value: 24 },
    ])).toMatchObject([
      { testName: 'White Blood Cell Count', unit: 'K/uL' },
      { testName: 'CO2 (Bicarbonate)', unit: 'mmol/L' },
    ]);
  });
});
