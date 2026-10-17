export type RoomAvailabilityInput = {
  primarySchoolId: string | null | undefined;
  selectedSchoolIds: readonly string[];
  allSchools: boolean;
  validSchoolIds: ReadonlySet<string>;
};

export type RoomAvailabilityDiff = {
  addedSchoolIds: string[];
  removedSchoolIds: string[];
  beforeLabel: string;
  afterLabel: string;
};

export function normalizeRoomAvailability(input: RoomAvailabilityInput): string[] {
  const primarySchoolId = input.primarySchoolId?.trim() || '';
  if (!primarySchoolId) throw new Error('A primary school is required.');
  if (!input.validSchoolIds.has(primarySchoolId)) throw new Error('The primary school is not in your authorized school scope.');
  if (input.allSchools) return [];

  const selected = Array.from(new Set(input.selectedSchoolIds.map((id) => id.trim()).filter(Boolean)));
  const invalid = selected.filter((id) => !input.validSchoolIds.has(id));
  if (invalid.length) throw new Error('One or more selected schools are not valid in your authorized school scope.');
  return Array.from(new Set([primarySchoolId, ...selected]));
}

export function describeRoomAvailabilityChange(
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined,
  primarySchoolId: string,
  authorizedSchoolIds: readonly string[] = [],
): RoomAvailabilityDiff {
  const directory = new Set(authorizedSchoolIds.filter(Boolean));
  const effective = (value: readonly string[] | null | undefined) => {
    if (Array.isArray(value) && value.length === 0) return new Set(directory);
    if (value == null) return new Set(primarySchoolId ? [primarySchoolId] : []);
    return new Set([primarySchoolId, ...value].filter((id) => !directory.size || directory.has(id)));
  };
  const previousIds = effective(previous);
  const nextIds = effective(next);
  const label = (value: readonly string[] | null | undefined) => {
    if (Array.isArray(value) && value.length === 0) return 'All schools';
    if (value == null) return 'Primary school only';
    return 'Specific schools';
  };
  return {
    addedSchoolIds: [...nextIds].filter((id) => !previousIds.has(id) && id !== primarySchoolId),
    removedSchoolIds: [...previousIds].filter((id) => !nextIds.has(id) && id !== primarySchoolId),
    beforeLabel: label(previous),
    afterLabel: label(next),
  };
}
