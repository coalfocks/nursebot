export const getClinicalRoomAvailabilityFields = (isExistingRoom: boolean) =>
  isExistingRoom ? {} : { available_school_ids: [] as string[] };
