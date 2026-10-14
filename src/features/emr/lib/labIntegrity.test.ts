import { describe, expect, it } from 'vitest';
import {
  classifyLabResult,
  getDefaultReferenceRange,
  parseNumericLabValue,
  parseNumericReferenceRange,
} from './labIntegrity';
import { resolveLabTemplates } from './aiLabGenerator';

describe('lab integrity', () => {
  it('parses bounded numeric ranges without accepting malformed text', () => {
    expect(parseNumericReferenceRange(' -2 to +2 ')).toEqual({ low: -2, high: 2 });
    expect(parseNumericReferenceRange('3.5–5.0')).toEqual({ low: 3.5, high: 5 });
    expect(parseNumericReferenceRange('5-3')).toBeNull();
    expect(parseNumericReferenceRange('1-2-3')).toBeNull();
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
