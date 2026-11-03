import { instantLabs, labTypeByName, pendingLabs } from './labCatalog';
import type { LabResult } from './types';

export type RequestedLab = { testName: string; unit: string; referenceRange: string };

export const normalizeLabName = (value: string) => value.toLowerCase().replace(/[–—]/g, '-').replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const canonicalLabKey = (value: string) => {
  const normalized = normalizeLabName(value);
  const aliases: Record<string, string> = {
    wbc: 'white blood cell count',
    'white blood cells': 'white blood cell count',
    hgb: 'hemoglobin',
    hct: 'hematocrit',
    plt: 'platelets',
    bicarbonate: 'co2',
    'co2 bicarbonate': 'co2',
    cr: 'creatinine',
  };
  return aliases[normalized] ?? normalized;
};
const catalogNames = (names: string[]) => new Set(names.map(normalizeLabName));
const instantNames = catalogNames(instantLabs);
const pendingNames = catalogNames(pendingLabs);

export const isPendingLab = (orderName: string) => pendingNames.has(normalizeLabName(orderName)) || labTypeByName.get(orderName.trim()) === 'pending';
export const isInstantLab = (orderName: string) => {
  const normalized = normalizeLabName(orderName);
  const panelAlias = ['cbc', 'complete blood count', 'basic metabolic panel', 'bmp', 'comprehensive metabolic panel', 'cmp']
    .some((alias) => normalized === alias || normalized.startsWith(`${alias} `));
  return !isPendingLab(orderName) && (panelAlias || instantNames.has(normalized) || labTypeByName.get(orderName.trim()) === 'instant');
};
export const shouldGenerateLabForOrder = (orderName: string, priority: string) => isInstantLab(orderName) && ['Routine', 'Timed', 'STAT'].includes(priority);

export const validateCompleteLabPanel = (requested: RequestedLab[], generated: unknown): LabResult[] => {
  if (!Array.isArray(generated) || generated.length !== requested.length) throw new Error(`Lab generator returned an incomplete panel (${Array.isArray(generated) ? generated.length : 0}/${requested.length}).`);
  const requestedByName = new Map(requested.map((test) => [canonicalLabKey(test.testName), test]));
  const seen = new Set<string>();
  return generated.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Lab result ${index + 1} is invalid.`);
    const result = entry as Record<string, unknown>;
    const testName = typeof result.testName === 'string' ? result.testName : '';
    const key = canonicalLabKey(testName);
    const expected = requestedByName.get(key);
    if (!expected || seen.has(key)) throw new Error(`Lab generator returned an unexpected or duplicate test: ${testName || index + 1}.`);
    if (result.value === null || result.value === undefined || result.value === '') throw new Error(`Lab generator returned no value for ${expected.testName}.`);
    seen.add(key);
    return {
      id: typeof result.id === 'string' ? result.id : `generated-lab-${Date.now()}-${index}`,
      patientId: '', testName: expected.testName, value: result.value as string | number,
      unit: typeof result.unit === 'string' ? result.unit : expected.unit,
      referenceRange: typeof result.referenceRange === 'string' ? result.referenceRange : expected.referenceRange,
      status: result.status === 'Abnormal' || result.status === 'Critical' ? result.status : 'Normal',
      collectionTime: typeof result.collectionTime === 'string' ? result.collectionTime : new Date().toISOString(),
      resultTime: typeof result.resultTime === 'string' ? result.resultTime : new Date().toISOString(), orderedBy: 'EMR Auto',
    } as LabResult;
  });
};
