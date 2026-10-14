export type AvailabilityValue = string[] | null | undefined;

export type AvailabilityDirectoryEntry = { id: string; label: string };

export type AvailabilityChange = {
  beforeLabel: string;
  afterLabel: string;
  addedIds: string[];
  removedIds: string[];
  addedLabels: string[];
  removedLabels: string[];
};

const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

export function effectiveAvailabilitySet(
  value: AvailabilityValue,
  primarySchoolId: string,
  authorizedSchoolIds: string[],
): Set<string> {
  const authorized = new Set(unique(authorizedSchoolIds));
  if (value && value.length === 0) return authorized;
  if (value == null) return new Set(primarySchoolId ? [primarySchoolId] : []);
  return new Set(unique([primarySchoolId, ...value]).filter((id) => authorized.has(id)));
}

function stateLabel(value: AvailabilityValue, directory: AvailabilityDirectoryEntry[], primarySchoolId: string) {
  if (Array.isArray(value) && value.length === 0) return 'All schools';
  const ids = effectiveAvailabilitySet(value, primarySchoolId, directory.map((entry) => entry.id));
  if (ids.size <= 1 && ids.has(primarySchoolId)) return 'Primary school only';
  const labels = directory.filter((entry) => ids.has(entry.id)).map((entry) => entry.label);
  return labels.length ? `Specific schools: ${labels.join(', ')}` : 'No authorized schools';
}

export function describeRoomAvailabilityChange(
  before: AvailabilityValue,
  after: AvailabilityValue,
  primarySchoolId: string,
  directory: AvailabilityDirectoryEntry[],
): AvailabilityChange {
  const directoryIds = directory.map((entry) => entry.id);
  const beforeSet = effectiveAvailabilitySet(before, primarySchoolId, directoryIds);
  const afterSet = effectiveAvailabilitySet(after, primarySchoolId, directoryIds);
  const addedIds = directoryIds.filter((id) => afterSet.has(id) && !beforeSet.has(id));
  const removedIds = directoryIds.filter((id) => beforeSet.has(id) && !afterSet.has(id));
  const labelById = new Map(directory.map((entry) => [entry.id, entry.label]));
  return {
    beforeLabel: stateLabel(before, directory, primarySchoolId),
    afterLabel: stateLabel(after, directory, primarySchoolId),
    addedIds,
    removedIds,
    addedLabels: addedIds.map((id) => labelById.get(id) ?? id),
    removedLabels: removedIds.map((id) => labelById.get(id) ?? id),
  };
}

export function availabilityPatchValue(
  allSchools: boolean,
  selectedSchoolIds: string[],
  primarySchoolId: string,
): string[] {
  if (allSchools) return [];
  return unique([primarySchoolId, ...selectedSchoolIds]);
}
