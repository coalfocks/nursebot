import { describe, expect, it } from 'vitest';
import { availabilityPatchValue, describeRoomAvailabilityChange } from './roomAvailability';

const directory = [
  { id: 'primary', label: 'Primary' },
  { id: 'uofa', label: 'University of Arizona' },
  { id: 'other', label: 'Other' },
];

describe('room availability transitions', () => {
  it('reports null to specific as primary-only to the selected schools', () => {
    expect(describeRoomAvailabilityChange(null, ['primary', 'uofa'], 'primary', directory)).toEqual({
      beforeLabel: 'Primary school only',
      afterLabel: 'Specific schools: Primary, University of Arizona',
      addedIds: ['uofa'],
      removedIds: [],
      addedLabels: ['University of Arizona'],
      removedLabels: [],
    });
  });

  it('reports all to specific without falsely adding already-allowed schools', () => {
    expect(describeRoomAvailabilityChange([], ['primary', 'uofa'], 'primary', directory)).toEqual({
      beforeLabel: 'All schools',
      afterLabel: 'Specific schools: Primary, University of Arizona',
      addedIds: [],
      removedIds: ['other'],
      addedLabels: [],
      removedLabels: ['Other'],
    });
  });

  it('reports specific to all as additions of only newly allowed schools', () => {
    expect(describeRoomAvailabilityChange(['primary', 'uofa'], [], 'primary', directory)).toEqual({
      beforeLabel: 'Specific schools: Primary, University of Arizona',
      afterLabel: 'All schools',
      addedIds: ['other'],
      removedIds: [],
      addedLabels: ['Other'],
      removedLabels: [],
    });
  });

  it('always includes primary in a specific patch', () => {
    expect(availabilityPatchValue(false, ['uofa'], 'primary')).toEqual(['primary', 'uofa']);
    expect(availabilityPatchValue(true, ['uofa'], 'primary')).toEqual([]);
  });
});
