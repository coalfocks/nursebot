import { describe, expect, it } from 'vitest';
import { expandMarSchedule } from './marSchedule';

describe('MAR schedule expansion', () => {
  it('expands q4h from 12 hours through 4 hours prior', () => {
    expect(expandMarSchedule({ medicationName: 'Example', frequency: 'q4h', historyHours: 12, firstDosePriorHours: 12 }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ relativeOffsetHours: 12 }),
        expect.objectContaining({ relativeOffsetHours: 8 }),
        expect.objectContaining({ relativeOffsetHours: 4 }),
      ]));
  });

  it('keeps BID/TID/QID as explicit preview frequencies', () => {
    expect(expandMarSchedule({ medicationName: 'TID', frequency: 'TID', historyHours: 12, firstDosePriorHours: 12 }))
      .toHaveLength(2);
    expect(expandMarSchedule({ medicationName: 'QID', frequency: 'QID', historyHours: 12, firstDosePriorHours: 12 }))
      .toHaveLength(3);
  });

  it('supports PRN assumed use and a single bolus', () => {
    expect(expandMarSchedule({ medicationName: 'PRN', frequency: 'PRN', category: 'prn', historyHours: 12, firstDosePriorHours: 8, assumePrnGiven: false })).toHaveLength(0);
    expect(expandMarSchedule({ medicationName: 'PRN', frequency: 'PRN', category: 'prn', historyHours: 12, firstDosePriorHours: 8, assumePrnGiven: true })).toHaveLength(1);
    expect(expandMarSchedule({ medicationName: 'Bolus', frequency: 'Once', category: 'one_time', historyHours: 12, firstDosePriorHours: 12 })).toHaveLength(1);
  });

  it('does not create administrations for infusions or learner orders', () => {
    expect(expandMarSchedule({ medicationName: 'Infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4 })).toHaveLength(0);
  });
});
