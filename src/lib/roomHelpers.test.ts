import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRoomDisplayName } from './roomHelpers';
import type { Database } from './database.types';

type Room = Database['public']['Tables']['rooms']['Row'];

describe('roomHelpers', () => {
  describe('getRoomDisplayName', () => {
    it('returns the role name when role is present', () => {
      const room: Pick<Room, 'role' | 'room_number'> = {
        role: 'ICU',
        room_number: 101,
      };
      expect(getRoomDisplayName(room)).toBe('ICU');
    });

    it('returns "Room {room_number}" when role is empty string', () => {
      const room: Pick<Room, 'role' | 'room_number'> = {
        role: '',
        room_number: 205,
      };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(getRoomDisplayName(room)).toBe('Room 205');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Room 205 has no name (empty role field). Displaying room number as fallback.'
      );

      consoleWarnSpy.mockRestore();
    });

    it('returns "Room {room_number}" when role is whitespace only', () => {
      const room: Pick<Room, 'role' | 'room_number'> = {
        role: '   ',
        room_number: 305,
      };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(getRoomDisplayName(room)).toBe('Room 305');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Room 305 has no name (empty role field). Displaying room number as fallback.'
      );

      consoleWarnSpy.mockRestore();
    });

    it('returns "Room {room_number}" when role is null', () => {
      const room: Pick<Room, 'role' | 'room_number'> = {
        role: null,
        room_number: 401,
      };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(getRoomDisplayName(room)).toBe('Room 401');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Room 401 has no name (empty role field). Displaying room number as fallback.'
      );

      consoleWarnSpy.mockRestore();
    });

    it('returns role name even when it contains special characters', () => {
      const room: Pick<Room, 'role' | 'room_number'> = {
        role: 'ICU-Stepdown',
        room_number: 102,
      };
      expect(getRoomDisplayName(room)).toBe('ICU-Stepdown');
    });
  });
});
