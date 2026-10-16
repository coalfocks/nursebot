import { describe, expect, it } from 'vitest';
import {
  classifyLabResult,
  getDefaultReferenceRange,
  getPatientReferenceRange,
  normalizeLabResultForPatient,
  parseNumericLabValue,
  parseNumericReferenceRange,
} from './labIntegrity';
import { resolveLabTemplates } from './aiLabGenerator';

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
    expect(resolveLabTemplates('CBC').map((test) => test.testName)).toEqual(expect.arrayContaining(['Neutrophils %', 'Lymphocytes %']));
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
});
