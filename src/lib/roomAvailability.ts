export type RoomAvailabilityInput = {
  primarySchoolId: string | null | undefined;
  selectedSchoolIds: readonly string[];
  allSchools: boolean;
  validSchoolIds: ReadonlySet<string>;
};

export type RoomAvailabilityDiff = {
  addedSchoolIds: string[];
  removedSchoolIds: string[];
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
  next: readonly string[],
  primarySchoolId: string,
): RoomAvailabilityDiff {
  // null/undefined and [] both mean all schools; compare their effective sets
  // only when a concrete list is available from the admin's school directory.
  const previousIds = new Set((previous ?? []).filter((id) => id && id !== primarySchoolId));
  const nextIds = new Set(next.filter((id) => id && id !== primarySchoolId));
  return {
    addedSchoolIds: [...nextIds].filter((id) => !previousIds.has(id)),
    removedSchoolIds: [...previousIds].filter((id) => !nextIds.has(id)),
  };
}
