import { describe, expect, it } from 'vitest';
import { buildTimelineChartRows } from './materializeHospitalTimeline';
import type { HospitalTimeline } from './hospitalTimeline';

const timeline: HospitalTimeline = {
  encounterType: 'inpatient',
  stayDays: 2,
  priorContextHours: 12,
  entries: [
    { id: 'admission', kind: 'admission', hospitalDay: 1, offsetHours: 0, title: 'Admission H&P', content: 'Admitted for pneumonia.' },
    { id: 'wbc-1', kind: 'lab', hospitalDay: 1, offsetHours: 8, title: 'WBC day 1', content: 'WBC', analyte: 'WBC', value: '15.2', unit: 'K/uL', trend: 'improving' },
    { id: 'progress-2', kind: 'progress_note', hospitalDay: 2, offsetHours: 32, title: 'Hospital day 2', content: 'Improving on treatment.' },
    { id: 'wbc-2', kind: 'lab', hospitalDay: 2, offsetHours: 36, title: 'WBC day 2', content: 'WBC', analyte: 'WBC', value: '11.4', unit: 'K/uL', trend: 'improving' },
    { id: 'page', kind: 'nurse_page', hospitalDay: 2, offsetHours: 40, title: 'Overnight page', content: 'New concern.' },
  ],
};

describe('hospital timeline chart adapter', () => {
  it('materializes dated notes and labs with stable entry provenance', () => {
    const rows = buildTimelineChartRows(timeline, {
      patientId: 'patient-1',
      roomId: 9001,
      schoolId: 'school-1',
      caseBlueprintId: 'blueprint-1',
      generatedAt: '2026-10-15T12:00:00.000Z',
    });

    expect(rows.notes.map((row) => row.timeline_entry_id)).toEqual(['admission', 'progress-2']);
    expect(rows.labs.map((row) => row.timeline_entry_id)).toEqual(['wbc-1', 'wbc-2']);
    expect(rows.labs.map((row) => row.collection_time)).toEqual([
      '2026-10-14T04:00:00.000Z',
      '2026-10-15T08:00:00.000Z',
    ]);
    expect(rows.vitals).toHaveLength(0);
    expect(rows.notes.every((row) => row.room_id === 9001 && row.patient_id === 'patient-1')).toBe(true);
  });

  it('materializes relative offsets and imaging without learner-facing dates', () => {
    const rows = buildTimelineChartRows({
      ...timeline,
      entries: [{ id: 'xray', kind: 'imaging', hospitalDay: 1, relativeHoursBeforeEncounter: 24, title: 'Chest x-ray', content: 'No focal opacity.', studyType: 'Chest x-ray', report: 'No focal opacity.' }],
    }, { patientId: 'patient-1', roomId: 9001, schoolId: 'school-1', generatedAt: '2026-10-15T12:00:00.000Z' });
    expect(rows.imaging[0]).toMatchObject({ timeline_entry_id: 'xray', relative_offset_hours: 24, study_type: 'Chest x-ray' });
    expect(rows.imaging[0].order_time).toBe('2026-10-14T12:00:00.000Z');
  });
});
