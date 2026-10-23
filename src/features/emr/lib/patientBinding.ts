export type CanonicalRoomPatientResult<T> =
  | { status: 'resolved'; patient: T; roomId: number }
  | { status: 'unbound' }
  | { status: 'mismatch'; reason: string };

export function resolveCanonicalRoomPatient<T extends { id: string }>(
  room: { id?: number | null; patient_id?: string | null; patient?: T | null } | null | undefined,
  roomId: number,
): CanonicalRoomPatientResult<T> {
  if (!room?.patient_id) return { status: 'unbound' };
  if (!room.patient || room.patient.id !== room.patient_id) {
    return { status: 'mismatch', reason: 'Room canonical patient binding did not resolve to the same patient.' };
  }
  if (room.id != null && room.id !== roomId) {
    return { status: 'mismatch', reason: 'Room readback does not match the requested room.' };
  }
  return { status: 'resolved', patient: room.patient, roomId };
}
