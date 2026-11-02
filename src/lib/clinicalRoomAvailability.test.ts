import { describe, expect, it } from 'vitest';
import { getClinicalRoomAvailabilityFields } from './clinicalRoomAvailability';

describe('clinical room availability persistence', () => {
  it('defaults brand-new rooms to all schools', () => {
    expect(getClinicalRoomAvailabilityFields(false)).toEqual({ available_school_ids: [] });
  });

  it('does not add availability fields to existing-room updates', () => {
    const existingPayload = { room_number: '101', school_id: 'school-1' };

    expect({ ...existingPayload, ...getClinicalRoomAvailabilityFields(true) }).toEqual(existingPayload);
  });
});
