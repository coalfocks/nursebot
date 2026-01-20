import type { Database } from './database.types';

type Room = Database['public']['Tables']['rooms']['Row'];

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
