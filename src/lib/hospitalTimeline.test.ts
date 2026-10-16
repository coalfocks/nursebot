import { describe, expect, it } from 'vitest';
import { DEFAULT_HOSPITAL_TIMELINE, hospitalTimelineChanged, parseHospitalTimeline, renderHospitalTimelineForNurse, relativeOffsetLabel, validateHospitalTimeline, type HospitalTimeline } from './hospitalTimeline';

const timeline = (overrides: Partial<HospitalTimeline> = {}): HospitalTimeline => ({
  encounterType: 'inpatient',
  stayDays: 2,
  priorContextHours: 12,
  entries: [
    { id: 'admit', kind: 'admission', hospitalDay: 1, offsetHours: 0, title: 'Admission H&P', content: 'Admitted.' },
    { id: 'p1', kind: 'progress_note', hospitalDay: 1, offsetHours: 8, title: 'Day 1 progress', content: 'Stable.' },
    { id: 'p2', kind: 'progress_note', hospitalDay: 2, offsetHours: 32, title: 'Day 2 progress', content: 'Improving.' },
    { id: 'page', kind: 'nurse_page', hospitalDay: 2, offsetHours: 36, title: 'Overnight page', content: 'New concern.' },
  ],
  ...overrides,
});

describe('hospital timeline validation', () => {
  it('requires daily notes and keeps the page in the final 12 hours', () => {
    expect(validateHospitalTimeline(timeline())).toEqual([]);
    expect(validateHospitalTimeline(timeline({ entries: timeline().entries.filter((entry) => entry.id !== 'p2') }))).toContain('Hospital day 2 requires one chronological progress note.');
    expect(validateHospitalTimeline(timeline({ entries: timeline().entries.map((entry) => entry.id === 'page' ? { ...entry, offsetHours: 10 } : entry) }))).toContain('The nurse page must remain in the final 12-hour context window.');
  });

  it('accepts an admission H&P as the first-night clinical record', () => {
    const firstNight: HospitalTimeline = {
      encounterType: 'inpatient',
      stayDays: 1,
      priorContextHours: 12,
      entries: [{ id: 'admit', kind: 'admission', hospitalDay: 1, offsetHours: 0, title: 'Admission H&P', content: 'Initial encounter history and exam.' }],
    };
    expect(validateHospitalTimeline(firstNight)).toEqual([]);
  });

  it('allows an unchanged incomplete legacy timeline for context-only save', () => {
    const source = { encounterType: 'inpatient', stayDays: 1, entries: [] };
    const original = parseHospitalTimeline(source);
    const reformatted = parseHospitalTimeline(JSON.parse(JSON.stringify(source)));
    expect(hospitalTimelineChanged(reformatted, original)).toBe(false);
    expect(validateHospitalTimeline(original)).toContain('Hospital day 1 requires one chronological progress note.');
    expect(hospitalTimelineChanged(DEFAULT_HOSPITAL_TIMELINE, DEFAULT_HOSPITAL_TIMELINE)).toBe(false);
  });

  it('rejects multi-day ED courses and stays beyond three days', () => {
    expect(validateHospitalTimeline(timeline({ encounterType: 'ed', stayDays: 2 }))).toContain('ED cases are single-encounter visits and cannot span multiple inpatient days.');
    expect(validateHospitalTimeline(timeline({ stayDays: 4 }))).toContain('Hospital stay must be 1–3 days.');
  });

  it('requires typed lab values and units', () => {
    expect(validateHospitalTimeline(timeline({ entries: [...timeline().entries, { id: 'lab', kind: 'lab', hospitalDay: 1, offsetHours: 4, title: 'WBC', content: 'WBC', analyte: 'WBC', value: '12' }] }))).toContain('Each lab entry needs an analyte, value, and unit.');
  });

  it('uses relative-hour labels and keeps imaging in nurse trend facts', () => {
    const relative: HospitalTimeline = {
      encounterType: 'inpatient', stayDays: 2, priorContextHours: 12,
      entries: [
        { id: 'admit', kind: 'admission', hospitalDay: 1, relativeHoursBeforeEncounter: 48, title: 'Admission H&P', content: 'Admitted.' },
        { id: 'p1', kind: 'progress_note', hospitalDay: 1, relativeHoursBeforeEncounter: 36, title: 'Progress', content: 'Stable.' },
        { id: 'p2', kind: 'progress_note', hospitalDay: 2, relativeHoursBeforeEncounter: 24, title: 'Progress', content: 'Improving.' },
        { id: 'img', kind: 'imaging', hospitalDay: 1, relativeHoursBeforeEncounter: 24, title: 'Chest radiograph', content: 'Study', studyType: 'Chest x-ray', report: 'Bibasilar opacity.' },
        { id: 'page', kind: 'nurse_page', hospitalDay: 2, relativeHoursBeforeEncounter: 8, title: 'Page', content: 'New concern.' },
      ],
    };
    expect(validateHospitalTimeline(relative)).toEqual([]);
    expect(validateHospitalTimeline({ ...relative, entries: [...relative.entries].reverse() })).toContain('Timeline entries must be chronological by relative offset.');
    expect(relativeOffsetLabel(relative.entries[3])).toBe('24 hours prior');
    expect(renderHospitalTimelineForNurse(relative)).toContain('24 hours prior Chest x-ray');
    expect(renderHospitalTimelineForNurse(relative)).not.toContain('Day 1');
  });
});
