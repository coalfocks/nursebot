export type MarCategory = 'scheduled' | 'prn' | 'one_time' | 'infusion';
export type MarStatus = 'Given' | 'Held' | 'Refused' | 'Not given' | 'Started' | 'Rate changed' | 'Stopped' | 'Not documented';

export interface MarDraftOccurrence {
  id?: string;
  occurrenceKey: string;
  relativeOffsetHours: number;
  administeredAt?: string | null;
  medicationName: string;
  orderedDose?: string;
  administeredDose?: string;
  unit?: string;
  route?: string;
  frequency?: string;
  category: MarCategory;
  status: MarStatus;
  simulatedClinician?: string;
  reason?: string;
  prnIndication?: string;
  response?: string;
  infusionDetails?: Record<string, unknown> | null;
  orderId?: string | null;
  caseVersion?: string | null;
  source?: 'authored_scenario' | 'simulation' | 'learner';
}

export interface MarScheduleInput {
  medicationName: string;
  orderId?: string | null;
  orderedDose?: string;
  unit?: string;
  route?: string;
  frequency: string;
  category?: MarCategory;
  historyHours: number;
  firstDosePriorHours: number;
  assumePrnGiven?: boolean;
  stopPriorHours?: number | null;
  caseVersion?: string | null;
}

const frequencyHours = (frequency: string): number | null => {
  const normalized = frequency.trim().toLowerCase().replace(/\s+/g, '');
  const qHours = normalized.match(/^q(\d+(?:\.\d+)?)h$/);
  if (qHours) return Number(qHours[1]);
  if (normalized === 'bid') return 12;
  if (normalized === 'tid') return 8;
  if (normalized === 'qid') return 6;
  if (normalized === 'qhs' || normalized === 'nightly') return 24;
  return null;
};

export const expandMarSchedule = (input: MarScheduleInput): MarDraftOccurrence[] => {
  const historyHours = Math.min(72, Math.max(0, input.historyHours));
  const first = Math.min(72, Math.max(0, input.firstDosePriorHours));
  const category = input.category ?? 'scheduled';
  if (category === 'prn') {
    return input.assumePrnGiven ? [{
      occurrenceKey: `${input.orderId ?? input.medicationName}:prn:${first}`,
      relativeOffsetHours: first,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category,
      status: 'Given',
      caseVersion: input.caseVersion,
      source: 'authored_scenario',
    }] : [];
  }
  if (category === 'one_time' || /^once$/i.test(input.frequency.trim())) {
    return [{
      occurrenceKey: `${input.orderId ?? input.medicationName}:once:${first}`,
      relativeOffsetHours: first,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category: 'one_time',
      status: 'Given',
      caseVersion: input.caseVersion,
      source: 'authored_scenario',
    }];
  }
  if (category === 'infusion') return [];
  const interval = frequencyHours(input.frequency);
  if (!interval || interval <= 0) return [];
  const occurrences: MarDraftOccurrence[] = [];
  const stop = input.stopPriorHours === null || input.stopPriorHours === undefined
    ? 0
    : Math.max(0, input.stopPriorHours);
  for (let offset = first; offset >= stop && offset <= historyHours; offset -= interval) {
    occurrences.push({
      occurrenceKey: `${input.orderId ?? input.medicationName}:scheduled:${offset}`,
      relativeOffsetHours: offset,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category: 'scheduled',
      status: 'Given',
      caseVersion: input.caseVersion,
      source: 'authored_scenario',
    });
  }
  return occurrences;
};
