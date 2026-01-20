import type { Database } from './database.types';
import { supabase } from './supabase';

type Room = Database['public']['Tables']['rooms']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];

/**
 * Get the display name for a room, with fallback to room number if role is missing
 * Logs a warning to console if the room has no name (empty role field)
 */
export const getRoomDisplayName = (room: Pick<Room, 'role' | 'room_number'>): string => {
  if (!room.role || room.role.trim() === '') {
    console.warn(`Room ${room.room_number} has no name (empty role field). Displaying room number as fallback.`);
    return `Room ${room.room_number}`;
  }
  return room.role;
};

/**
 * Fetch specialties by IDs. Handles both single specialty_id and specialty_ids array.
 * Returns an array of specialties.
 */
export const fetchSpecialtiesForRoom = async (room: Pick<Room, 'specialty_id' | 'specialty_ids'>): Promise<Specialty[]> => {
  const ids: string[] = [];

  // Add from single specialty_id (legacy)
  if (room.specialty_id) {
    ids.push(room.specialty_id);
  }

  // Add from specialty_ids array (multi-select)
  if (Array.isArray(room.specialty_ids)) {
    room.specialty_ids.forEach((id) => {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    });
  }

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('specialties')
    .select('*')
    .in('id', ids);

  if (error) {
    console.error('Error fetching specialties:', error);
    return [];
  }

  return data || [];
};
