export type EncounterType = 'inpatient' | 'ed' | 'ld';

export type HospitalTimelineEntry = {
  id: string;
  kind: 'admission' | 'progress_note' | 'consult' | 'lab' | 'vital' | 'procedure' | 'nurse_page';
  hospitalDay: number;
  offsetHours: number;
  title: string;
  content: string;
  analyte?: string;
  value?: string;
  unit?: string;
  trend?: 'stable' | 'improving' | 'worsening';
  consultant?: string;
  recommendation?: string;
};

export type HospitalTimeline = {
  encounterType: EncounterType;
  stayDays: number;
  priorContextHours: 12;
  entries: HospitalTimelineEntry[];
};

export const DEFAULT_HOSPITAL_TIMELINE: HospitalTimeline = {
  encounterType: 'inpatient',
  stayDays: 1,
  priorContextHours: 12,
  entries: [],
};

export function parseHospitalTimeline(value: unknown): HospitalTimeline {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_HOSPITAL_TIMELINE;
  const candidate = value as Partial<HospitalTimeline>;
  return {
    encounterType: candidate.encounterType === 'ed' || candidate.encounterType === 'ld' ? candidate.encounterType : 'inpatient',
    stayDays: Number.isInteger(candidate.stayDays) ? Number(candidate.stayDays) : 1,
    priorContextHours: 12,
    entries: Array.isArray(candidate.entries) ? candidate.entries as HospitalTimelineEntry[] : [],
  };
}

export function validateHospitalTimeline(timeline: HospitalTimeline): string[] {
  const errors: string[] = [];
  if (!['inpatient', 'ed', 'ld'].includes(timeline.encounterType)) errors.push('Encounter type must be inpatient, ED, or L&D.');
  if (!Number.isInteger(timeline.stayDays) || timeline.stayDays < 1 || timeline.stayDays > 3) errors.push('Hospital stay must be 1–3 days.');
  if (timeline.encounterType === 'ed' && timeline.stayDays !== 1) errors.push('ED cases are single-encounter visits and cannot span multiple inpatient days.');
  if (timeline.encounterType === 'ld' && timeline.stayDays > 3) errors.push('L&D courses may span at most 3 days.');
  const maxOffset = timeline.stayDays * 24;
  const byDay = new Map<number, HospitalTimelineEntry[]>();
  for (const entry of timeline.entries) {
    if (!entry.id || !entry.kind || !entry.title.trim() || !entry.content.trim()) errors.push('Every timeline entry needs an id, type, title, and content.');
    if (!Number.isInteger(entry.hospitalDay) || entry.hospitalDay < 1 || entry.hospitalDay > timeline.stayDays) errors.push(`${entry.title || 'Timeline entry'} has a hospital day outside the configured stay.`);
    if (!Number.isFinite(entry.offsetHours) || entry.offsetHours < 0 || entry.offsetHours > maxOffset) errors.push(`${entry.title || 'Timeline entry'} has an invalid time offset.`);
    if (entry.kind === 'lab' && (!entry.analyte?.trim() || !entry.unit?.trim() || !entry.value?.trim())) errors.push('Each lab entry needs an analyte, value, and unit.');
    if (entry.kind === 'consult' && (!entry.consultant?.trim() || !entry.recommendation?.trim())) errors.push('Each consult entry needs a consultant and recommendation.');
    if (entry.kind === 'progress_note' && !entry.content.trim()) errors.push(`Hospital day ${entry.hospitalDay} needs a progress note.`);
    const day = byDay.get(entry.hospitalDay) ?? [];
    day.push(entry);
    byDay.set(entry.hospitalDay, day);
  }
  if (timeline.encounterType === 'inpatient' || timeline.encounterType === 'ld') {
    for (let day = 1; day <= timeline.stayDays; day += 1) {
      if (!(byDay.get(day) ?? []).some((entry) => entry.kind === 'progress_note')) errors.push(`Hospital day ${day} requires one chronological progress note.`);
    }
  }
  const offsets = timeline.entries.map((entry) => entry.offsetHours);
  if (offsets.some((offset, index) => index > 0 && offset < offsets[index - 1])) errors.push('Timeline entries must be chronological by offset.');
  if (timeline.entries.some((entry) => entry.kind === 'nurse_page' && entry.offsetHours < Math.max(0, maxOffset - 12))) errors.push('The nurse page must remain in the final 12-hour context window.');
  return [...new Set(errors)];
}

export function timelineTrend(timeline: HospitalTimeline) {
  return timeline.entries
    .filter((entry) => entry.kind === 'lab' && entry.analyte && entry.value)
    .map((entry) => `${entry.analyte}: ${entry.value} ${entry.unit ?? ''} · day ${entry.hospitalDay} · ${entry.trend ?? 'stable'}`);
}
