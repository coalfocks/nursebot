import { describe, expect, it } from 'vitest';
import { validateHospitalTimeline, type HospitalTimeline } from './hospitalTimeline';

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

  it('rejects multi-day ED courses and stays beyond three days', () => {
    expect(validateHospitalTimeline(timeline({ encounterType: 'ed', stayDays: 2 }))).toContain('ED cases are single-encounter visits and cannot span multiple inpatient days.');
    expect(validateHospitalTimeline(timeline({ stayDays: 4 }))).toContain('Hospital stay must be 1–3 days.');
  });

  it('requires typed lab values and units', () => {
    expect(validateHospitalTimeline(timeline({ entries: [...timeline().entries, { id: 'lab', kind: 'lab', hospitalDay: 1, offsetHours: 4, title: 'WBC', content: 'WBC', analyte: 'WBC', value: '12' }] }))).toContain('Each lab entry needs an analyte, value, and unit.');
  });
});
