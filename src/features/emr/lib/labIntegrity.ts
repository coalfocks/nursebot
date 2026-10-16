import type { LabResult, Patient } from './types';

export type NumericReferenceRange = {
  low: number;
  high: number;
};

export type PatientLabDemographics = {
  gender?: Patient['gender'] | null;
  dateOfBirth?: string | null;
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
// Keep the numeric bounds strict, but accept the unit/annotation suffixes that
// are part of a displayed lab interval (for example `10-45 U/L` or
// `57-254 U/L (female, age 13-<15 years)`). A suffix must begin with a unit,
// percent sign, or parenthetical annotation so malformed values such as
// `1-2-3` remain invalid.
const CLOSED_RANGE_PATTERN = new RegExp(
  `^\\s*(${NUMBER_PATTERN})\\s*(?:-|–|—|to)\\s*(${NUMBER_PATTERN})(?:\\s*(?=[A-Za-zµμ%]|\\()[\\s\\S]*)?\\s*$`,
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

// Simulator reference intervals are intentionally explicit by age band. They are
// used for deterministic display/classification and are not a substitute for a
// laboratory's local reference catalog.
type PediatricReferenceBand = {
  maxMonths: number;
  hemoglobin: NumericReferenceRange;
  hematocrit: NumericReferenceRange;
  whiteBloodCellCount: NumericReferenceRange;
};

const PEDIATRIC_REFERENCE_BANDS: PediatricReferenceBand[] = [
  { maxMonths: 1, hemoglobin: { low: 13.5, high: 19.5 }, hematocrit: { low: 42, high: 65 }, whiteBloodCellCount: { low: 9, high: 30 } },
  { maxMonths: 6, hemoglobin: { low: 9.5, high: 14.1 }, hematocrit: { low: 29, high: 41 }, whiteBloodCellCount: { low: 6, high: 17.5 } },
  { maxMonths: 12, hemoglobin: { low: 10.5, high: 14 }, hematocrit: { low: 33, high: 42 }, whiteBloodCellCount: { low: 6, high: 17.5 } },
  { maxMonths: 72, hemoglobin: { low: 11, high: 14.5 }, hematocrit: { low: 32, high: 42 }, whiteBloodCellCount: { low: 5, high: 15.5 } },
  { maxMonths: 144, hemoglobin: { low: 11.5, high: 15.5 }, hematocrit: { low: 35, high: 45 }, whiteBloodCellCount: { low: 4.5, high: 13.5 } },
  { maxMonths: 216, hemoglobin: { low: 12, high: 16 }, hematocrit: { low: 36, high: 46 }, whiteBloodCellCount: { low: 4.5, high: 13.5 } },
];

const parseDateOnlyUtc = (value: string): Date | null => {
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
  const parsed = new Date(`${match}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const calculateAgeInMonths = (dateOfBirth: unknown, asOf: unknown = new Date()): number | null => {
  if (typeof dateOfBirth !== 'string' || !dateOfBirth || typeof asOf !== 'string' && !(asOf instanceof Date)) return null;
  const birth = parseDateOnlyUtc(dateOfBirth);
  const reference = asOf instanceof Date ? asOf : parseDateOnlyUtc(asOf);
  if (!birth || !reference || reference < birth) return null;
  let months = (reference.getUTCFullYear() - birth.getUTCFullYear()) * 12
    + reference.getUTCMonth() - birth.getUTCMonth();
  if (reference.getUTCDate() < birth.getUTCDate()) months -= 1;
  return Math.max(0, months);
};

const pediatricBandFor = (dateOfBirth: string | null | undefined, asOf: unknown): PediatricReferenceBand | null => {
  const ageMonths = calculateAgeInMonths(dateOfBirth, asOf);
  if (ageMonths === null || ageMonths >= 216) return null;
  return PEDIATRIC_REFERENCE_BANDS.find((band) => ageMonths < band.maxMonths)
    ?? PEDIATRIC_REFERENCE_BANDS[PEDIATRIC_REFERENCE_BANDS.length - 1]
    ?? null;
};

const pediatricRangeFor = (
  testName: string,
  demographics: PatientLabDemographics,
  asOf: unknown,
): NumericReferenceRange | null => {
  const band = pediatricBandFor(demographics.dateOfBirth, asOf);
  if (!band) return null;
  const ageMonths = calculateAgeInMonths(demographics.dateOfBirth, asOf);
  if (ageMonths !== null && ageMonths >= 144) {
    if (analyteKey(testName) === 'hemoglobin') {
      return demographics.gender === 'Male' ? { low: 13, high: 16 } : { low: 12, high: 16 };
    }
    if (analyteKey(testName) === 'hematocrit') {
      return demographics.gender === 'Male' ? { low: 37, high: 49 } : { low: 36, high: 46 };
    }
  }
  switch (analyteKey(testName)) {
    case 'hemoglobin':
      return band.hemoglobin;
    case 'hematocrit':
      return band.hematocrit;
    case 'white blood cell count':
      return band.whiteBloodCellCount;
    default:
      return null;
  }
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
  dateOfBirth?: string | null,
  asOf: unknown = new Date(),
): NumericReferenceRange | null => {
  const key = analyteKey(testName);
  const pediatricRange = pediatricRangeFor(testName, { gender: sex, dateOfBirth }, asOf);
  if (pediatricRange) return pediatricRange;
  if (key !== 'hemoglobin' && key !== 'hematocrit') return null;
  // Female is the historic fallback and remains the fallback for Other/unknown.
  return SEX_SPECIFIC_DEFAULTS[key][sex === 'Male' ? 'Male' : 'Female'];
};

/** Reconcile historical sex-dependent ranges for display without rewriting stored rows. */
export const getPatientReferenceRange = (
  testName: string,
  storedReferenceRange: unknown,
  sex?: Patient['gender'] | null,
  dateOfBirth?: string | null,
  asOf: unknown = new Date(),
): string => {
  const defaultRange = sex === 'Male' || sex === 'Female'
    ? getDefaultReferenceRange(testName, sex, dateOfBirth, asOf)
    : null;
  return defaultRange
    ? formatNumericReferenceRange(defaultRange)
    : (typeof storedReferenceRange === 'string' ? storedReferenceRange : '');
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

export const normalizeLabResultForPatient = <T extends Pick<LabResult, 'testName' | 'value' | 'referenceRange'> & Partial<LabResult>>(
  lab: T,
  sex?: Patient['gender'] | null,
  dateOfBirth?: string | null,
): T & Pick<LabResult, 'status' | 'abnormalFlag'> => normalizeLabResult({
  ...lab,
  referenceRange: getPatientReferenceRange(lab.testName, lab.referenceRange, sex, dateOfBirth, lab.collectionTime),
});
