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
    expect(expandMarSchedule({ medicationName: 'Long stay', frequency: 'q4h', historyHours: 12, stayHours: 48, firstDosePriorHours: 48 }))
      .toHaveLength(12);
    expect(expandMarSchedule({ medicationName: 'Late start', frequency: 'q4h', historyHours: 48, stayHours: 48, firstDosePriorHours: 12 }))
      .toHaveLength(3);
  });

  it('keeps BID/TID/QID as explicit preview frequencies', () => {
    expect(expandMarSchedule({ medicationName: 'TID', frequency: 'TID', historyHours: 12, firstDosePriorHours: 12, explicitPriorHours: [12, 4] }))
      .toHaveLength(2);
    expect(expandMarSchedule({ medicationName: 'QID', frequency: 'QID', historyHours: 12, firstDosePriorHours: 12, explicitPriorHours: [12, 6] }))
      .toHaveLength(2);
    expect(() => expandMarSchedule({ medicationName: 'TID', frequency: 'TID', historyHours: 12, firstDosePriorHours: 12 }))
      .toThrow('MAR_EXPLICIT_TIMES_REQUIRED');
  });

  it('supports PRN assumed use and a single bolus', () => {
    expect(expandMarSchedule({ medicationName: 'PRN', frequency: 'PRN', category: 'prn', historyHours: 12, firstDosePriorHours: 8, assumePrnGiven: false })).toHaveLength(0);
    expect(expandMarSchedule({ medicationName: 'PRN', frequency: 'q4h', category: 'prn', historyHours: 12, firstDosePriorHours: 12, assumePrnGiven: true })).toHaveLength(3);
    expect(() => expandMarSchedule({ medicationName: 'PRN', frequency: 'PRN', category: 'prn', historyHours: 12, firstDosePriorHours: 8, assumePrnGiven: true }))
      .toThrow('MAR_EXPLICIT_TIMES_REQUIRED');
    expect(expandMarSchedule({ medicationName: 'Bolus', frequency: 'Once', category: 'one_time', historyHours: 12, firstDosePriorHours: 12 })).toHaveLength(1);
    expect(() => expandMarSchedule({ medicationName: 'Bolus now', frequency: 'Once', category: 'one_time', historyHours: 12, firstDosePriorHours: 0 })).toThrow('MAR_ZERO_HOUR_BASELINE');
  });

  it('rejects invalid schedule relationships instead of silently clamping authored values', () => {
    expect(() => expandMarSchedule({ medicationName: 'Long', frequency: 'q4h', historyHours: 96, firstDosePriorHours: 96 })).toThrow('MAR_HISTORY_EXCEEDS_MAXIMUM');
    expect(() => expandMarSchedule({ medicationName: 'Late', frequency: 'q4h', historyHours: 48, stayHours: 48, firstDosePriorHours: 60 })).toThrow('MAR_START_OUTSIDE_STAY');
    expect(() => expandMarSchedule({ medicationName: 'Bad', frequency: 'q4h', historyHours: 12, firstDosePriorHours: 12, stopPriorHours: 16 })).toThrow('MAR_STOP_BEFORE_START');
    expect(() => expandMarSchedule({ medicationName: 'Bad', frequency: 'q4h', historyHours: Number.NaN, firstDosePriorHours: 12 })).toThrow('MAR_INVALID_HISTORY_HOURS');
    expect(() => expandMarSchedule({ medicationName: 'PRN TID', frequency: 'TID', category: 'prn', historyHours: 24, firstDosePriorHours: 24, assumePrnGiven: true })).toThrow('MAR_EXPLICIT_TIMES_REQUIRED');
    expect(() => expandMarSchedule({ medicationName: 'PRN q4h', frequency: 'q4h', category: 'prn', historyHours: 48, firstDosePriorHours: 48, stopPriorHours: 0, assumePrnGiven: true })).toThrow('MAR_STOP_MUST_PRECEDE_FIRST_PAGE');
    expect(() => expandMarSchedule({ medicationName: 'Explicit zero', frequency: 'TID', historyHours: 12, firstDosePriorHours: 12, explicitPriorHours: [12, 4, 0] })).toThrow('MAR_TIME_MUST_PRECEDE_FIRST_PAGE');
    expect(() => expandMarSchedule({ medicationName: 'Fractional', frequency: 'q4h', historyHours: 12.5, firstDosePriorHours: 12.5, stopPriorHours: 0 }))
      .toThrow('MAR_STOP_MUST_PRECEDE_FIRST_PAGE');
  });

  it('does not create administrations for infusions or learner orders', () => {
    expect(expandMarSchedule({ medicationName: 'Infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4, infusionEvents: [{ offsetHours: 12, status: 'Started', rate: '50 mL/h' }, { offsetHours: 4, status: 'Rate changed', rate: '75 mL/h' }] })).toHaveLength(2);
    expect(() => expandMarSchedule({ medicationName: 'Bad infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4, infusionEvents: [{ offsetHours: 13, status: 'Started' }] })).toThrow('MAR_TIME_OUTSIDE_STAY');
    expect(() => expandMarSchedule({ medicationName: 'Bad infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4, infusionEvents: [{ offsetHours: 8, status: 'Stopped' }, { offsetHours: 4, status: 'Started' }] })).toThrow('MAR_INFUSION_START_STOP_CONFLICT');
    expect(() => expandMarSchedule({ medicationName: 'Bad infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4, infusionEvents: [{ offsetHours: 8, status: 'Started' }, { offsetHours: 6, status: 'Stopped' }, { offsetHours: 4, status: 'Rate changed' }] })).toThrow('MAR_INFUSION_RATE_CHANGE_CONFLICT');
    expect(() => expandMarSchedule({ medicationName: 'Bad infusion', frequency: 'continuous', category: 'infusion', historyHours: 12, firstDosePriorHours: 4, infusionEvents: [{ offsetHours: 0, status: 'Started' }] })).toThrow('MAR_ZERO_HOUR_BASELINE');
  });
});
