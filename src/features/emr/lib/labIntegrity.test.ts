import { describe, expect, it } from 'vitest';
import {
  classifyLabResult,
  getDefaultReferenceRange,
  getPatientReferenceRange,
  normalizeLabResultForPatient,
  parseNumericLabValue,
  parseNumericReferenceRange,
} from './labIntegrity';
import { isClinicallyCoherentPanel, resolveLabTemplates, validateGeneratedLabResults } from './aiLabGenerator';
import type { LabResult } from './types';

describe('lab integrity', () => {
  it('parses bounded numeric ranges without accepting malformed text', () => {
    expect(parseNumericReferenceRange(' -2 to +2 ')).toEqual({ low: -2, high: 2 });
    expect(parseNumericReferenceRange('3.5–5.0')).toEqual({ low: 3.5, high: 5 });
    expect(parseNumericReferenceRange('10-45 U/L')).toEqual({ low: 10, high: 45 });
    expect(parseNumericReferenceRange('57–254 U/L (female, age 13-<15 years)')).toEqual({ low: 57, high: 254 });
    expect(parseNumericReferenceRange('5-3')).toBeNull();
    expect(parseNumericReferenceRange('1-2-3')).toBeNull();
    expect(parseNumericReferenceRange('1-2-3mg/dL')).toBeNull();
    expect(parseNumericReferenceRange('normal')).toBeNull();
    expect(parseNumericReferenceRange(null)).toBeNull();
  });

  it('uses inclusive range boundaries for numeric results', () => {
    expect(classifyLabResult('Creatinine', 0.6, '0.7-1.3').status).toBe('Abnormal');
    expect(classifyLabResult('Creatinine', 0.7, '0.7-1.3').status).toBe('Normal');
    expect(classifyLabResult('Creatinine', 1, '0.7-1.3').status).toBe('Normal');
    expect(classifyLabResult('Creatinine', 1.3, '0.7-1.3').status).toBe('Normal');
    expect(classifyLabResult('Creatinine', 1.4, '0.7-1.3').status).toBe('Abnormal');
  });

  it('marks critical values only at explicit inclusive analyte thresholds', () => {
    expect(classifyLabResult('Potassium', 2.5, '3.5-5.0')).toMatchObject({ status: 'Critical', basis: 'critical-threshold' });
    expect(classifyLabResult('Potassium', 6.5, '3.5-5.0')).toMatchObject({ status: 'Critical', basis: 'critical-threshold' });
    expect(classifyLabResult('Potassium', 2.6, '3.5-5.0').status).toBe('Abnormal');
    expect(classifyLabResult('Unregistered analyte', 1000, '0-10').status).toBe('Abnormal');
  });

  it('provides sex-specific hematology defaults with the historic fallback', () => {
    expect(getDefaultReferenceRange('Hemoglobin', 'Male')).toEqual({ low: 13.5, high: 17.5 });
    expect(getDefaultReferenceRange('Hemoglobin', 'Female')).toEqual({ low: 12, high: 15.5 });
    expect(getDefaultReferenceRange('Hemoglobin', 'Other')).toEqual({ low: 12, high: 15.5 });
    expect(getDefaultReferenceRange('Hematocrit', undefined)).toEqual({ low: 36, high: 46 });
    expect(resolveLabTemplates('CBC', 'Male').find((test) => test.testName === 'Hemoglobin')?.referenceRange).toBe('13.5-17.5');
    expect(resolveLabTemplates('CBC', 'Female').find((test) => test.testName === 'Hematocrit')?.referenceRange).toBe('36-46');
    expect(resolveLabTemplates('CBC').find((test) => test.testName === 'Hemoglobin')?.referenceRange).toBe('12.0-15.5');
  });

  it('reclassifies historical sex-dependent rows without changing stored chart data', () => {
    expect(getPatientReferenceRange('Hemoglobin', '12.0-15.5', 'Male')).toBe('13.5-17.5');
    expect(getPatientReferenceRange('Hematocrit', '36-46', 'Male')).toBe('41-53');
    expect(getPatientReferenceRange('White Blood Cell Count', '4.0-11.0', 'Male')).toBe('4.0-11.0');
    const historical = { testName: 'Hemoglobin', value: 15.6, referenceRange: '12.0-15.5', status: 'Abnormal' as const };
    expect(normalizeLabResultForPatient(historical, 'Male')).toMatchObject({
      referenceRange: '13.5-17.5', status: 'Normal', abnormalFlag: false,
    });
    expect(historical.referenceRange).toBe('12.0-15.5');
  });

  it('uses pediatric age bands instead of adult or one generic pediatric range', () => {
    expect(getDefaultReferenceRange('Hemoglobin', 'Female', '2025-01-01', '2025-03-01')).toEqual({ low: 9.5, high: 14.1 });
    expect(getDefaultReferenceRange('White Blood Cell Count', 'Male', '2018-01-01', '2026-01-01')).toEqual({ low: 4.5, high: 13.5 });
    expect(getDefaultReferenceRange('Hemoglobin', 'Female', '2012-01-01', '2026-01-01')).toEqual({ low: 12, high: 16 });
    expect(getDefaultReferenceRange('Hemoglobin', 'Male', '2012-01-01', '2026-01-01')).toEqual({ low: 13, high: 16 });
    expect(getDefaultReferenceRange('Hemoglobin', 'Male', '2010-01-01', '2026-01-01')).toEqual({ low: 13, high: 16 });
  });

  it('reclassifies historical pediatric results using the age at collection', () => {
    const schoolAgeMale = {
      testName: 'Hemoglobin', value: 16, referenceRange: '13.5-17.5',
      collectionTime: '2026-01-01T12:00:00.000Z', status: 'Normal' as const,
    };
    expect(normalizeLabResultForPatient(schoolAgeMale, 'Male', '2018-01-01')).toMatchObject({
      referenceRange: '11.5-15.5', status: 'Abnormal', abnormalFlag: true,
    });

    const adolescentFemale = {
      testName: 'Hemoglobin', value: 15.8, referenceRange: '12.0-15.5',
      collectionTime: '2026-01-01T12:00:00.000Z', status: 'Abnormal' as const,
    };
    expect(normalizeLabResultForPatient(adolescentFemale, 'Female', '2012-01-01')).toMatchObject({
      referenceRange: '12-16', status: 'Normal', abnormalFlag: false,
    });
  });

  it('classifies numeric pediatric chemistry results when displayed ranges include units and age annotations', () => {
    const room401Results = [
      { testName: 'ALT', value: 1358, referenceRange: '10-45 U/L' },
      { testName: 'AST', value: 1200, referenceRange: '15-40 U/L' },
      { testName: 'Total Bilirubin', value: 1.8, referenceRange: '0.2-1.2 mg/dL' },
      { testName: 'Alkaline Phosphatase', value: 180, referenceRange: '57–254 U/L (female, age 13-<15 years)' },
      { testName: 'Platelets', value: 275, referenceRange: '150-450 K/uL' },
      { testName: 'Creatinine', value: 0.8, referenceRange: '0.5-1.0 mg/dL' },
    ];

    const normalized = room401Results.map((lab) => normalizeLabResultForPatient(
      lab,
      'Female',
      '2011-11-15',
    ));

    expect(normalized.slice(0, 3).map((lab) => lab.status)).toEqual(['Abnormal', 'Abnormal', 'Abnormal']);
    expect(normalized.slice(0, 3).every((lab) => lab.abnormalFlag === true)).toBe(true);
    expect(normalized.slice(3).map((lab) => lab.status)).toEqual(['Normal', 'Normal', 'Normal']);
  });

  it('does not coerce malformed or qualitative values into numeric classifications', () => {
    expect(parseNumericLabValue('12 mg/dL')).toBeNull();
    expect(parseNumericLabValue('12abc')).toBeNull();
    expect(parseNumericLabValue(Number.NaN)).toBeNull();
    expect(classifyLabResult('COVID-19 PCR', 'Detected', 'See interpretation')).toEqual({
      status: 'Abnormal',
      abnormalFlag: null,
      basis: 'qualitative-rule',
    });
    expect(classifyLabResult('ABO/Rh', 'O positive', '')).toEqual({
      status: 'Unknown',
      abnormalFlag: null,
      basis: 'unknown',
    });
    expect(classifyLabResult('Creatinine', 'not a number', '0.7-1.3').status).toBe('Unknown');
    expect(classifyLabResult('Creatinine', 1, 'broken').status).toBe('Unknown');
  });

  it('routes culture orders to a pending microbiology schema instead of a default chemistry panel', () => {
    const tests = resolveLabTemplates('Blood Culture x2 (Peripheral)');
    expect(tests.map((test) => test.testName)).toEqual(['Blood Culture x2 (Peripheral)']);
    expect(tests[0]?.resultKind).toBe('pending-microbiology');
    expect(validateGeneratedLabResults([
      { testName: 'White Blood Cell Count', value: 15.3, referenceRange: '4-11' },
    ], tests)).toEqual([]);
    expect(validateGeneratedLabResults([
      { testName: 'Blood Culture x2 (Peripheral)', value: '', narrative: 'Pending: organism not finalized' },
    ], tests)).toMatchObject([{
      testName: 'Blood Culture x2 (Peripheral)',
      valueType: 'coded',
      lifecycleStatus: 'pending',
      status: 'Pending',
      specimen: 'Peripheral blood',
    }]);
  });

  it('rejects admission-jitter glucose/ketone output for a DKA case', () => {
    const tests = resolveLabTemplates('BMP');
    expect(validateGeneratedLabResults([
      ...tests.map((test) => ({ testName: test.testName, value: test.testName === 'Glucose' ? 97.2 : 140, referenceRange: test.referenceRange })),
    ], tests, { caseInstructions: 'Opening glucose 570 with Kussmaul breathing after insulin was omitted.' })).toEqual([]);
  });

  it('rejects incoherent VBG values instead of persisting them', () => {
    expect(isClinicallyCoherentPanel([
      { testName: 'pH (Venous)', value: 6.7 },
      { testName: 'pCO2 (Venous)', value: 44.4 },
      { testName: 'HCO3 (Venous)', value: 30.7 },
    ])).toBe(false);
  });

  it('does not use prior synthetic glucose rows as truth anchors', () => {
    const tests = resolveLabTemplates('Glucose POC');
    expect(validateGeneratedLabResults(
      [{ testName: 'Glucose', value: 97.2, referenceRange: tests[0].referenceRange }],
      tests,
      {
        assignmentId: 'attempt-1',
        previousLabs: [
          { testName: 'Glucose', value: 108, assignmentId: null },
          { testName: 'Glucose', value: 570, assignmentId: 'attempt-1' },
        ] as unknown as LabResult[],
      },
    )).toHaveLength(1);
  });

  it('allows a coherent post-treatment/euglycemic DKA panel', () => {
    const tests = resolveLabTemplates('VBG');
    expect(validateGeneratedLabResults([
      { testName: 'pH (Venous)', value: 7.25, referenceRange: tests[0].referenceRange },
      { testName: 'pCO2 (Venous)', value: 29, referenceRange: tests[1].referenceRange },
      { testName: 'HCO3 (Venous)', value: 16, referenceRange: tests[2].referenceRange },
      { testName: 'Base Excess', value: -10, referenceRange: tests[3].referenceRange },
    ], tests, { caseInstructions: 'DKA after treatment; euglycemic stage.', caseStage: 'post-treatment', treatmentActions: [{ name: 'insulin infusion', status: 'given', occurredAt: '2026-10-16T11:10:00Z' }] })).toHaveLength(4);
  });

  it('requires every ordered CBC differential analyte', () => {
    const tests = resolveLabTemplates('CBC with Differential');
    const missingDifferential = tests
      .filter((test) => test.testName !== 'Neutrophils %')
      .map((test) => ({ testName: test.testName, value: 10, referenceRange: test.referenceRange }));
    expect(validateGeneratedLabResults(missingDifferential, tests)).toEqual([]);
  });

  it.each([
    ['CBC with Differential', ['White Blood Cell Count', 'Neutrophils %', 'Lymphocytes %', 'Hemoglobin', 'Hematocrit', 'Platelets']],
    ['Basic Metabolic Panel (BMP)', ['Sodium', 'Potassium', 'Chloride', 'CO2 (Bicarbonate)', 'BUN', 'Creatinine', 'Glucose', 'Calcium']],
    ['ABG with Co-oximetry', ['pH (Arterial)', 'PaCO2', 'PaO2', 'HCO3 (Arterial)', 'Lactate']],
    ['Lactate (Serum)', ['Lactate']],
  ])('keeps %s within its ordered analyte contract', (orderName, expected) => {
    expect(resolveLabTemplates(orderName).map((test) => test.testName)).toEqual(expected);
  });
});
