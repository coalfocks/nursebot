import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const CLINICAL_ROOM_IDS = [
  43, 44, 45, 24, 25, 26, 27, 78, 79, 80, 33, 54, 55, 56, 61, 73, 74, 75,
  76, 77, 34, 57, 58, 59, 60, 68, 69, 70, 71, 72, 42, 50, 51, 52, 53, 62,
  63, 64, 65, 66, 29, 46, 47, 48, 49, 81, 82, 83, 84, 85, 91, 32, 35, 36,
  37, 38, 39, 40, 41, 31,
] as const;

export const PROTECTED_ROOM_IDS = [102, 118] as const;

export type RawClinicalRoom = {
  id: number;
  room_number: string;
  role: string | null;
  school_id: string | null;
  available_school_ids: unknown;
  updated_at: string | null;
};

export type ClinicalAvailabilityStatus = 'global' | 'restricted' | 'malformed' | 'missing';

export type ClinicalAuditRow = RawClinicalRoom & {
  status: ClinicalAvailabilityStatus;
  original: RawClinicalRoom | null;
};

export type UpdateResult =
  | { kind: 'success'; roomId: number; updatedAt: string | null }
  | { kind: 'conflict'; roomId: number }
  | { kind: 'error'; roomId: number; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuidList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string' && UUID_PATTERN.test(id));

export const classifyAvailability = (value: unknown): Exclude<ClinicalAvailabilityStatus, 'missing'> => {
  if (value === null || (Array.isArray(value) && value.length === 0)) return 'global';
  if (isUuidList(value) && value.length > 0) return 'restricted';
  return 'malformed';
};

export const filterClinicalRooms = (rooms: RawClinicalRoom[]): RawClinicalRoom[] => {
  const allowedIds = new Set<number>(CLINICAL_ROOM_IDS);
  return rooms.filter((room) => allowedIds.has(room.id) && !PROTECTED_ROOM_IDS.includes(room.id as 102 | 118));
};

export const buildAuditRows = (rooms: RawClinicalRoom[]): ClinicalAuditRow[] => {
  const byId = new Map(filterClinicalRooms(rooms).map((room) => [room.id, room]));

  return CLINICAL_ROOM_IDS.map((id) => {
    const room = byId.get(id);
    if (!room) {
      return {
        id,
        room_number: String(id),
        role: null,
        school_id: null,
        available_school_ids: null,
        updated_at: null,
        status: 'missing',
        original: null,
      };
    }

    return {
      ...room,
      status: classifyAvailability(room.available_school_ids),
      original: { ...room },
    };
  });
};

export const isRestrictedCandidate = (row: ClinicalAuditRow): boolean => row.status === 'restricted';

type RoomsClient = SupabaseClient<Database>;

export const updateClinicalAvailability = async (
  client: RoomsClient,
  row: ClinicalAuditRow,
): Promise<UpdateResult> => {
  if (!isRestrictedCandidate(row) || !row.original) {
    return { kind: 'error', roomId: row.id, message: 'Row is not an eligible restricted clinical room.' };
  }

  let query = client
    .from('rooms')
    .update({ available_school_ids: [] })
    .eq('id', row.id);

  query = row.original.updated_at === null
    ? query.is('updated_at', null)
    : query.eq('updated_at', row.original.updated_at);

  const { data, error } = await query
    .select('available_school_ids,updated_at')
    .maybeSingle();

  if (error) return { kind: 'error', roomId: row.id, message: error.message };
  if (!data) return { kind: 'conflict', roomId: row.id };
  if (!Array.isArray(data.available_school_ids) || data.available_school_ids.length !== 0) {
    return { kind: 'error', roomId: row.id, message: 'Readback did not confirm available_school_ids = [].' };
  }

  return { kind: 'success', roomId: row.id, updatedAt: data.updated_at };
};

export const formatRawAvailability = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return value.length === 0 ? '[]' : JSON.stringify(value);
  return JSON.stringify(value);
};
