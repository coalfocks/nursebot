export type EncounterType = 'inpatient' | 'ed' | 'ld';

export type HospitalTimelineEntry = {
  id: string;
  kind: 'admission' | 'progress_note' | 'consult' | 'lab' | 'vital' | 'procedure' | 'imaging' | 'nurse_page';
  hospitalDay: number;
  /** Relative hours before the student encounter. Zero is the encounter anchor. */
  relativeHoursBeforeEncounter?: number;
  /** Legacy authoring alias; accepted on read and normalized on write. */
  offsetHours?: number;
  title: string;
  content: string;
  analyte?: string;
  value?: string;
  unit?: string;
  trend?: 'stable' | 'improving' | 'worsening';
  consultant?: string;
  recommendation?: string;
  studyType?: string;
  report?: string;
  impression?: string;
  vitals?: {
    temperature?: number;
    bloodPressureSystolic?: number;
    bloodPressureDiastolic?: number;
    heartRate?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
    pain?: number;
  };
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
    entries: Array.isArray(candidate.entries) ? (candidate.entries as HospitalTimelineEntry[]).map((entry) => ({
      ...entry,
      relativeHoursBeforeEncounter: Number.isFinite(entry.relativeHoursBeforeEncounter)
        ? Number(entry.relativeHoursBeforeEncounter)
        : Number(entry.offsetHours ?? 0),
    })) : [],
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
    const relativeHours = entryRelativeHours(entry);
    if (!Number.isFinite(relativeHours) || relativeHours < 0 || relativeHours > maxOffset) errors.push(`${entry.title || 'Timeline entry'} has an invalid relative-hour offset.`);
    if (entry.kind === 'lab' && (!entry.analyte?.trim() || !entry.unit?.trim() || !entry.value?.trim())) errors.push('Each lab entry needs an analyte, value, and unit.');
    if (entry.kind === 'consult' && (!entry.consultant?.trim() || !entry.recommendation?.trim())) errors.push('Each consult entry needs a consultant and recommendation.');
    if (entry.kind === 'imaging' && (!entry.studyType?.trim() || !entry.report?.trim())) errors.push('Each imaging entry needs a study type and report.');
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
  const offsets = timeline.entries.map(entryRelativeHours);
  const usesRelativeOffsets = timeline.entries.some((entry) => entry.relativeHoursBeforeEncounter !== undefined);
  const outOfOrder = usesRelativeOffsets
    ? offsets.some((offset, index) => index > 0 && offset > offsets[index - 1])
    : offsets.some((offset, index) => index > 0 && offset < offsets[index - 1]);
  if (outOfOrder) errors.push('Timeline entries must be chronological by relative offset.');
  if (timeline.entries.some((entry) => entry.kind === 'nurse_page' && (entry.relativeHoursBeforeEncounter === undefined
    ? entryRelativeHours(entry) < Math.max(0, maxOffset - 12)
    : entryRelativeHours(entry) > 12))) errors.push('The nurse page must remain in the final 12-hour context window.');
  return [...new Set(errors)];
}

export function timelineTrend(timeline: HospitalTimeline) {
  return timeline.entries
    .filter((entry) => entry.kind === 'lab' && entry.analyte && entry.value)
    .map((entry) => `${entry.analyte}: ${entry.value} ${entry.unit ?? ''} · ${relativeOffsetLabel(entry)} · ${entry.trend ?? 'stable'}`);
}

export function entryRelativeHours(entry: HospitalTimelineEntry): number {
  return Number.isFinite(entry.relativeHoursBeforeEncounter) ? entry.relativeHoursBeforeEncounter : Number(entry.offsetHours ?? 0);
}

export function relativeOffsetLabel(entry: HospitalTimelineEntry): string {
  const hours = entryRelativeHours(entry);
  return hours === 0 ? 'At encounter' : `${hours} hours prior`;
}

export const HOSPITAL_TIMELINE_NURSE_MARKER = '[AUTHORED HOSPITAL COURSE]';

/**
 * The authored timeline is chart context, not learner activity. This compact
 * block is deliberately facts-only so the nurse can answer a requested trend
 * without volunteering the evaluation key or dumping the whole chart.
 */
export function renderHospitalTimelineForNurse(timeline: HospitalTimeline): string {
  const entries = [...timeline.entries].sort((a, b) => entryRelativeHours(b) - entryRelativeHours(a));
  const facts = entries
    .filter((entry) => ['admission', 'progress_note', 'consult', 'lab', 'vital', 'imaging', 'procedure'].includes(entry.kind))
    .map((entry) => {
      const label = relativeOffsetLabel(entry);
      if (entry.kind === 'lab') return `${label} ${entry.analyte}: ${entry.value} ${entry.unit ?? ''}`.trim();
      if (entry.kind === 'vital' && entry.vitals) return `${label} vital signs: ${Object.entries(entry.vitals).map(([key, value]) => `${key} ${value}`).join(', ')}`;
      if (entry.kind === 'consult' && entry.consultant) return `${label} ${entry.consultant} consult: ${entry.recommendation ?? entry.content}`;
      if (entry.kind === 'imaging') return `${label} ${entry.studyType ?? entry.title}: ${entry.impression ?? entry.report ?? entry.content}`;
      return `${label} ${entry.title}: ${entry.content}`;
    });
  if (!facts.length) return '';
  return `${HOSPITAL_TIMELINE_NURSE_MARKER}\nVerified chart history and trends (answer only when asked; do not volunteer a data dump or hidden goals):\n${facts.join('\n')}`;
}

export function mergeHospitalTimelineIntoNurseContext(current: string | null | undefined, timeline: HospitalTimeline): string {
  const block = renderHospitalTimelineForNurse(timeline);
  const withoutPrevious = (current ?? '').replace(new RegExp(`\\n?${HOSPITAL_TIMELINE_NURSE_MARKER}[\\s\\S]*$`), '').trim();
  return [withoutPrevious, block].filter(Boolean).join('\n\n');
}

export function timelineAnchorTimestamp(timeline: HospitalTimeline, generatedAt = new Date().toISOString()): string {
  const legacyEntries = timeline.entries.filter((entry) => entry.relativeHoursBeforeEncounter === undefined);
  if (legacyEntries.length === timeline.entries.length) {
    const maxOffset = timeline.entries.reduce((max, entry) => Math.max(max, Number(entry.offsetHours ?? 0)), 0);
    return new Date(new Date(generatedAt).getTime() - maxOffset * 60 * 60 * 1000).toISOString();
  }
  return generatedAt;
}

export function timelineEntryTimestamp(timeline: HospitalTimeline, entry: HospitalTimelineEntry, generatedAt?: string): string {
  if (entry.relativeHoursBeforeEncounter === undefined) {
    return new Date(new Date(timelineAnchorTimestamp(timeline, generatedAt)).getTime() + Number(entry.offsetHours ?? 0) * 60 * 60 * 1000).toISOString();
  }
  return new Date(new Date(generatedAt ?? new Date().toISOString()).getTime() - entryRelativeHours(entry) * 60 * 60 * 1000).toISOString();
}
