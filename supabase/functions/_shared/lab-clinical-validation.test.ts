import { describe, expect, it } from 'vitest';
import { validateClinicalLabPanel } from './lab-clinical-validation';

describe('clinical lab panel validation', () => {
  it('rejects normal admission-jitter results for an authored DKA case', () => {
    const result = validateClinicalLabPanel([
      { testName: 'Glucose', value: 97.2 },
      { testName: 'Beta-Hydroxybutyrate', value: 0.1 },
      { testName: 'Sodium', value: 140 },
      { testName: 'Chloride', value: 113.3 },
      { testName: 'CO2 (Bicarbonate)', value: 21.6 },
    ], { nurseContext: 'Deep Kussmaul breathing; insulin was omitted; opening glucose 570.' });
    expect(result).toEqual({ ok: false, reason: 'case glucose is inconsistent with the authored hyperglycemic scenario' });
  });

  it('rejects a VBG whose pH, CO2, and bicarbonate cannot coexist', () => {
    const result = validateClinicalLabPanel([
      { testName: 'pH (Venous)', value: 6.7 },
      { testName: 'pCO2 (Venous)', value: 44.4 },
      { testName: 'HCO3 (Venous)', value: 30.7 },
    ]);
    expect(result).toEqual({ ok: false, reason: 'acid-base values are internally inconsistent' });
  });

  it('rejects cross-panel glucose disagreement', () => {
    expect(validateClinicalLabPanel([
      { testName: 'Glucose', value: 570 },
      { testName: 'Glucose POC', value: 97.2 },
    ])).toEqual({ ok: false, reason: 'glucose values disagree across the ordered panel' });
  });

  it('does not use prior synthetic rows as truth anchors', () => {
    expect(validateClinicalLabPanel(
      [{ testName: 'Glucose', value: 97.2 }],
      {
        assignmentId: 'attempt-1',
        previousLabs: [
          { testName: 'Glucose', value: 108, assignmentId: null },
          { testName: 'Glucose', value: 570, assignmentId: 'attempt-1' },
        ],
      },
    )).toEqual({ ok: true });
  });

  it('allows a coherent post-treatment improvement and euglycemic DKA stage', () => {
    expect(validateClinicalLabPanel([
      { testName: 'Glucose', value: 180 },
      { testName: 'Beta-Hydroxybutyrate', value: 3.8 },
      { testName: 'CO2 (Bicarbonate)', value: 16 },
      { testName: 'pH (Venous)', value: 7.25 },
      { testName: 'pCO2 (Venous)', value: 29 },
      { testName: 'HCO3 (Venous)', value: 16 },
    ], { nurseContext: 'DKA with omitted insulin.', caseStage: 'post-treatment', treatmentActions: [{ name: 'insulin infusion', occurredAt: '2026-10-16T11:10:00Z', status: 'given' }] })).toEqual({ ok: true });
  });

  it('accepts a coherent authored DKA panel', () => {
    expect(validateClinicalLabPanel([
      { testName: 'Glucose', value: 570 },
      { testName: 'Beta-Hydroxybutyrate', value: 4.2 },
      { testName: 'Sodium', value: 140 },
      { testName: 'Chloride', value: 100 },
      { testName: 'CO2 (Bicarbonate)', value: 12 },
      { testName: 'pH (Venous)', value: 7.19 },
      { testName: 'pCO2 (Venous)', value: 32 },
      { testName: 'HCO3 (Venous)', value: 12 },
    ], { nurseContext: 'Kussmaul breathing with opening glucose 570 and omitted insulin.' })).toEqual({ ok: true });
  });
});
