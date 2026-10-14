import { labTypeByName } from './labCatalog';

export type LabMaterializationDecision = 'materialize' | 'pending' | 'already_satisfied';

const normalizeLabName = (name: string) => name
  .toLowerCase()
  .replace(/[\u2018\u2019']/g, '')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

export const getLabType = (orderName: string): 'instant' | 'pending' | null => {
  const direct = labTypeByName.get(orderName);
  if (direct) return direct;
  const normalized = normalizeLabName(orderName);
  if (/^(cbc|complete blood count)( with differential)?$/.test(normalized)) return 'instant';
  if (/^(bmp|basic metabolic panel)$/.test(normalized)) return 'instant';
  if (/^(cmp|comprehensive metabolic panel)$/.test(normalized)) return 'instant';
  for (const [name, type] of labTypeByName) {
    if (normalizeLabName(name) === normalized) return type;
  }
  return null;
};

export const decideLabMaterialization = ({
  category,
  orderName,
  existingResultCount,
  expectedResultCount,
}: {
  category: string;
  orderName: string;
  existingResultCount: number;
  expectedResultCount: number;
}): LabMaterializationDecision => {
  if (category !== 'Lab' || getLabType(orderName) !== 'instant') return 'pending';
  if (existingResultCount >= expectedResultCount && expectedResultCount > 0) return 'already_satisfied';
  return 'materialize';
};
