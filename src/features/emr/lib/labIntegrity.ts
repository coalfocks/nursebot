import type { LabResult, Patient } from './types';

export type NumericReferenceRange = {
  low: number;
  high: number;
};

export type LabClassification = {
  status: LabResult['status'];
  abnormalFlag: boolean | null;
  basis: 'numeric-range' | 'critical-threshold' | 'qualitative-rule' | 'pending' | 'unknown';
};

type CriticalThreshold = {
  low?: number;
  high?: number;
};

const NUMBER_PATTERN = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const CLOSED_RANGE_PATTERN = new RegExp(
  `^\\s*(${NUMBER_PATTERN})\\s*(?:-|–|—|to)\\s*(${NUMBER_PATTERN})\\s*(?:%)?\\s*$`,
  'i',
);
const NUMERIC_VALUE_PATTERN = new RegExp(`^\\s*${NUMBER_PATTERN}\\s*$`, 'i');

const analyteKey = (name: string) => name
  .toLowerCase()
  .replace(/[()]/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Deliberately bounded to analytes with stable units in this simulator.
const CRITICAL_THRESHOLDS: Record<string, CriticalThreshold> = {
  hemoglobin: { low: 6.5, high: 20 },
  hematocrit: { low: 20, high: 60 },
  'white blood cell count': { low: 2, high: 30 },
  platelets: { low: 50, high: 1000 },
  sodium: { low: 120, high: 160 },
  potassium: { low: 2.5, high: 6.5 },
  glucose: { low: 40, high: 500 },
  calcium: { low: 6.5, high: 13 },
};

const SEX_SPECIFIC_DEFAULTS: Record<'hemoglobin' | 'hematocrit', Record<'Male' | 'Female', NumericReferenceRange>> = {
  hemoglobin: {
    Male: { low: 13.5, high: 17.5 },
    Female: { low: 12, high: 15.5 },
  },
  hematocrit: {
    Male: { low: 41, high: 53 },
    Female: { low: 36, high: 46 },
  },
};

const QUALITATIVE_ANALYTE_PATTERN = /(?:pcr|antigen|antibody|culture|screen|toxin|smear|coombs|occult blood)/i;
const QUALITATIVE_NORMAL = new Set(['negative', 'not detected', 'nonreactive', 'no growth']);
const QUALITATIVE_ABNORMAL = new Set(['positive', 'detected', 'reactive', 'growth']);

export const parseNumericReferenceRange = (range: unknown): NumericReferenceRange | null => {
  if (typeof range !== 'string') return null;
  const match = CLOSED_RANGE_PATTERN.exec(range);
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
  return { low, high };
};

export const parseNumericLabValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !NUMERIC_VALUE_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getDefaultReferenceRange = (
  testName: string,
  sex?: Patient['gender'] | null,
): NumericReferenceRange | null => {
  const key = analyteKey(testName);
  if (key !== 'hemoglobin' && key !== 'hematocrit') return null;
  // Female is the historic fallback and remains the fallback for Other/unknown.
  return SEX_SPECIFIC_DEFAULTS[key][sex === 'Male' ? 'Male' : 'Female'];
};

export const formatNumericReferenceRange = (range: NumericReferenceRange): string =>
  `${range.low}-${range.high}`;

export const classifyLabResult = (
  testName: string,
  value: unknown,
  referenceRange: unknown,
  lifecycleStatus?: LabResult['lifecycleStatus'],
): LabClassification => {
  if (lifecycleStatus === 'pending' && (value === '' || value === null || value === undefined)) {
    return { status: 'Pending', abnormalFlag: null, basis: 'pending' };
  }

  const numericValue = parseNumericLabValue(value);
  if (numericValue !== null) {
    const threshold = CRITICAL_THRESHOLDS[analyteKey(testName)];
    if (
      threshold &&
      ((threshold.low !== undefined && numericValue <= threshold.low) ||
        (threshold.high !== undefined && numericValue >= threshold.high))
    ) {
      return { status: 'Critical', abnormalFlag: true, basis: 'critical-threshold' };
    }

    const range = parseNumericReferenceRange(referenceRange);
    if (!range) return { status: 'Unknown', abnormalFlag: null, basis: 'unknown' };
    const normal = numericValue >= range.low && numericValue <= range.high;
    return {
      status: normal ? 'Normal' : 'Abnormal',
      abnormalFlag: !normal,
      basis: 'numeric-range',
    };
  }

  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (QUALITATIVE_ANALYTE_PATTERN.test(testName)) {
    if (QUALITATIVE_NORMAL.has(normalizedValue)) {
      return { status: 'Normal', abnormalFlag: null, basis: 'qualitative-rule' };
    }
    if (QUALITATIVE_ABNORMAL.has(normalizedValue)) {
      return { status: 'Abnormal', abnormalFlag: null, basis: 'qualitative-rule' };
    }
  }

  return { status: 'Unknown', abnormalFlag: null, basis: 'unknown' };
};

export const normalizeLabResult = <T extends Pick<LabResult, 'testName' | 'value' | 'referenceRange'> & Partial<LabResult>>(
  lab: T,
): T & Pick<LabResult, 'status' | 'abnormalFlag'> => {
  const classification = classifyLabResult(lab.testName, lab.value, lab.referenceRange, lab.lifecycleStatus);
  return {
    ...lab,
    status: classification.status,
    abnormalFlag: classification.abnormalFlag,
  };
};
