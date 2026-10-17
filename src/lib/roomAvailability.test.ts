import { describe, expect, it } from 'vitest';
import { describeRoomAvailabilityChange, normalizeRoomAvailability } from './roomAvailability';

const validSchoolIds = new Set(['primary', 'ua', 'other']);

describe('room availability', () => {
  it('always includes the primary school and preserves a modern selection', () => {
    expect(normalizeRoomAvailability({
      primarySchoolId: 'primary', selectedSchoolIds: ['ua'], allSchools: false, validSchoolIds,
    })).toEqual(['primary', 'ua']);
  });

  it('represents all schools as the existing empty array contract', () => {
    expect(normalizeRoomAvailability({
      primarySchoolId: 'primary', selectedSchoolIds: ['ua'], allSchools: true, validSchoolIds,
    })).toEqual([]);
  });

  it('rejects a school outside the authorized directory', () => {
    expect(() => normalizeRoomAvailability({
      primarySchoolId: 'primary', selectedSchoolIds: ['not-authorized'], allSchools: false, validSchoolIds,
    })).toThrow('not valid');
  });

  it('reports added and removed school IDs without touching the primary', () => {
    expect(describeRoomAvailabilityChange(['primary', 'other'], ['primary', 'ua'], 'primary', ['primary', 'ua', 'other'])).toEqual({
      addedSchoolIds: ['ua'], removedSchoolIds: ['other'],
      beforeLabel: 'Specific schools', afterLabel: 'Specific schools',
    });
  });

  it('uses effective sets for null primary-only, all, and specific transitions', () => {
    const directory = ['primary', 'ua', 'other'];
    expect(describeRoomAvailabilityChange(null, ['primary', 'ua'], 'primary', directory)).toMatchObject({
      beforeLabel: 'Primary school only', afterLabel: 'Specific schools', addedSchoolIds: ['ua'], removedSchoolIds: [],
    });
    expect(describeRoomAvailabilityChange([], ['primary', 'ua'], 'primary', directory)).toMatchObject({
      beforeLabel: 'All schools', afterLabel: 'Specific schools', addedSchoolIds: [], removedSchoolIds: ['other'],
    });
    expect(describeRoomAvailabilityChange(['primary', 'ua'], [], 'primary', directory)).toMatchObject({
      beforeLabel: 'Specific schools', afterLabel: 'All schools', addedSchoolIds: ['other'], removedSchoolIds: [],
    });
  });
});
