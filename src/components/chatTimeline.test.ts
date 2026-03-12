import { describe, expect, it } from 'vitest';
import { buildTimelineEntries, getLabTimelineTimestamp, type AssignmentTimelineRow, type ChatMessage } from './chatTimeline';
import type { ImagingStudy, LabResult, MedicalOrder, VitalSigns } from '../features/emr/lib/types';

const baseMessage = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'msg-1',
  assignment_id: 'assignment-1',
  role: 'student',
  content: 'hello',
  created_at: '2026-03-12T10:00:00.000Z',
  triggered_completion: false,
  updated_at: null,
  metadata: null,
  ...overrides,
});

const baseOrder = (overrides: Partial<MedicalOrder>): MedicalOrder => ({
  id: 'order-1',
  patientId: 'patient-1',
  assignmentId: 'assignment-1',
  roomId: 2,
  overrideScope: 'assignment',
  category: 'Medication',
  orderName: 'Aspirin',
  priority: 'Routine',
  status: 'Active',
  orderedBy: 'Student',
  orderTime: '2026-03-12T10:05:00.000Z',
  ...overrides,
});

const baseLab = (overrides: Partial<LabResult>): LabResult => ({
  id: 'lab-1',
  patientId: 'patient-1',
  assignmentId: 'assignment-1',
  roomId: 2,
  overrideScope: 'assignment',
  testName: 'CBC',
  value: 7.4,
  unit: 'x10^3/uL',
  referenceRange: '',
  status: 'Normal',
  collectionTime: '2026-03-12T10:10:00.000Z',
  resultTime: '2026-03-12T10:15:00.000Z',
  orderedBy: 'Student',
  createdAt: '2026-03-12T10:15:00.000Z',
  ...overrides,
});

const baseVital = (overrides: Partial<VitalSigns>): VitalSigns => ({
  id: 'vital-1',
  patientId: 'patient-1',
  assignmentId: 'assignment-1',
  roomId: 2,
  overrideScope: 'assignment',
  timestamp: '2026-03-12T10:20:00.000Z',
  heartRate: 120,
  oxygenSaturation: 95,
  ...overrides,
});

const baseImaging = (overrides: Partial<ImagingStudy>): ImagingStudy => ({
  id: 'img-1',
  patientId: 'patient-1',
  assignmentId: 'assignment-1',
  roomId: 2,
  overrideScope: 'assignment',
  studyType: 'Chest X-Ray',
  orderTime: '2026-03-12T10:25:00.000Z',
  reportGeneratedAt: '2026-03-12T10:30:00.000Z',
  status: 'Completed',
  ...overrides,
});

describe('chatTimeline', () => {
  it('keeps the progress note as the final timeline entry', () => {
    const assignmentTimeline: AssignmentTimelineRow = {
      status: 'completed',
      student_progress_note: 'Final note',
      completed_at: '2026-03-12T10:12:00.000Z',
    };

    const entries = buildTimelineEntries(
      [baseMessage({ id: 'msg-1', created_at: '2026-03-12T10:00:00.000Z' })],
      [baseOrder({ id: 'order-1', orderTime: '2026-03-12T10:05:00.000Z' })],
      [baseLab({ id: 'lab-1', resultTime: '2026-03-12T10:18:00.000Z', createdAt: '2026-03-12T10:18:00.000Z' })],
      [baseVital({ id: 'vital-1', timestamp: '2026-03-12T10:22:00.000Z' })],
      [baseImaging({ id: 'img-1', reportGeneratedAt: '2026-03-12T10:24:00.000Z' })],
      assignmentTimeline,
    );

    expect(entries.map((entry) => entry.kind)).toEqual([
      'message',
      'order',
      'labs',
      'vital',
      'imaging',
      'progress-note',
    ]);
    expect(entries.at(-1)).toMatchObject({
      kind: 'progress-note',
      content: 'Final note',
    });
  });

  it('turns completion chat messages into completion events', () => {
    const entries = buildTimelineEntries(
      [
        baseMessage({ id: 'msg-1', role: 'assistant', content: '<completed>', created_at: '2026-03-12T10:00:00.000Z' }),
      ],
      [],
      [],
      [],
      [],
      null,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'completion' });
  });

  it('groups labs that occur in the same minute and sorts them by test name', () => {
    const entries = buildTimelineEntries(
      [],
      [],
      [
        baseLab({ id: 'lab-2', testName: 'CMP', resultTime: '2026-03-12T10:15:20.000Z', createdAt: '2026-03-12T10:15:20.000Z' }),
        baseLab({ id: 'lab-1', testName: 'BMP', resultTime: '2026-03-12T10:15:05.000Z', createdAt: '2026-03-12T10:15:05.000Z' }),
      ],
      [],
      [],
      null,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('labs');
    if (entries[0].kind !== 'labs') {
      throw new Error('Expected labs entry');
    }
    expect(entries[0].labs.map((lab) => lab.testName)).toEqual(['BMP', 'CMP']);
  });

  it('uses createdAt when baseline labs carry the sentinel timestamp', () => {
    const timestamp = getLabTimelineTimestamp(
      baseLab({
        overrideScope: 'baseline',
        collectionTime: '2000-01-01T00:00:00.000Z',
        resultTime: '2000-01-01T00:00:00.000Z',
        createdAt: '2026-03-12T09:00:00.000Z',
      }),
    );

    expect(timestamp).toBe('2026-03-12T09:00:00.000Z');
  });
});
