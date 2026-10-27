import { describe, expect, it } from 'vitest';
import { manualMarCanEdit, manualMarTimelineCellOffsetPercent, manualMarTimelinePositionPercent, mapManualMarPacket, validateManualMarEvents } from './manualMar';

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1', occurrenceKey: 'manual:event-1', medicationName: 'Example medication',
  category: 'scheduled', status: 'Given', relativeOffsetHours: 12, source: 'authored_scenario', orderId: null, ...overrides,
});

describe('manual MAR packet contract', () => {
  it('maps a persisted packet while preserving exact relative hours and no order', () => {
    const packet = mapManualMarPacket({ id: 'packet-1', patientId: 'patient-1', roomId: 7, caseVersion: 'manual-v1', revision: 3, events: [event({ relativeOffsetHours: 12.5 })] });
    expect(packet?.revision).toBe(3);
    expect(packet?.events[0]).toMatchObject({ relativeOffsetHours: 12.5, orderId: null, patientId: 'patient-1', roomId: 7 });
  });

  it('keeps every saved non-given status and fractional event in the packet reader', () => {
    const statuses = ['Held', 'Stopped', 'Not documented'] as const;
    const packet = mapManualMarPacket({
      id: 'packet-1', patientId: 'patient-1', roomId: 7, caseVersion: 'manual-v1', revision: 4,
      events: statuses.map((status, index) => event({ id: `event-${index}`, occurrenceKey: `manual:${index}`, status, relativeOffsetHours: 12.25 + index })),
    });
    expect(packet?.events.map((entry) => entry.status)).toEqual(statuses);
    expect(packet?.events.map((entry) => entry.relativeOffsetHours)).toEqual([12.25, 13.25, 14.25]);
  });

  it('rejects learner actions, order-linked rows, and out-of-range hours', () => {
    expect(() => validateManualMarEvents([event({ source: 'learner' })])).toThrow('MANUAL_MAR_LEARNER_SOURCE_REJECTED');
    expect(() => validateManualMarEvents([event({ orderId: 'order-1' })])).toThrow('MANUAL_MAR_ORDER_ID_NOT_ALLOWED');
    expect(() => validateManualMarEvents([event({ relativeOffsetHours: 72.1 })])).toThrow('MANUAL_MAR_RELATIVE_HOURS_INVALID');
    expect(() => validateManualMarEvents([event({ relativeOffsetHours: 0 })])).not.toThrow();
  });

  it('gates manual authoring to educators and superadmins outside assignments', () => {
    expect(manualMarCanEdit('school_admin', false, true)).toBe(true);
    expect(manualMarCanEdit('super_admin', false, true)).toBe(true);
    expect(manualMarCanEdit('student', false, true)).toBe(false);
    expect(manualMarCanEdit('school_admin', false, true, 'assignment-1')).toBe(false);
    expect(manualMarCanEdit('school_admin', true, true)).toBe(false);
  });

  it('keeps integer and fractional prior-hour events at distinct exact timeline positions', () => {
    expect(manualMarTimelinePositionPercent(12)).toBeCloseTo(16.6666666667);
    expect(manualMarTimelinePositionPercent(12.5)).toBeCloseTo(17.3611111111);
    expect(manualMarTimelinePositionPercent(12.5)).not.toBe(manualMarTimelinePositionPercent(12));
    expect(manualMarTimelineCellOffsetPercent(12.5)).toBe(50);
    expect(manualMarTimelineCellOffsetPercent(12.5)).not.toBe(manualMarTimelineCellOffsetPercent(12));
    expect(manualMarTimelineCellOffsetPercent(12)).toBe(0);
  });
});
