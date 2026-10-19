export const MINIMUM_EMR_PRIOR_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;
const MAX_DISPLAY_PRIOR_HOURS = 72;

export const resolveEncounterTime = (admissionDate?: string | null, fallback = new Date()): Date => {
  if (admissionDate) {
    const parsed = new Date(admissionDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

export const minimumPriorTimestamp = (admissionDate?: string | null, now = new Date()): string =>
  new Date(resolveEncounterTime(admissionDate, now).getTime() - MINIMUM_EMR_PRIOR_HOURS * HOUR_MS).toISOString();

/** Learner actions use encounter timestamps; authored baseline records use relative prior time. */
export const timestampForScope = (
  scope: 'baseline' | 'room' | 'assignment' | null | undefined,
  admissionDate?: string | null,
  now = new Date(),
): string => scope === 'assignment' ? now.toISOString() : minimumPriorTimestamp(admissionDate, now);

export const formatScopedEmrTimestamp = (
  timestamp: string | null | undefined,
  scope: 'baseline' | 'room' | 'assignment' | null | undefined,
  admissionDate?: string | null,
  relativeOffsetHours?: number | null,
): string => {
  if (relativeOffsetHours !== null && relativeOffsetHours !== undefined && Number.isFinite(relativeOffsetHours)) {
    if (relativeOffsetHours <= 0) return 'During encounter';
    return `${relativeOffsetHours} hours prior`;
  }
  if (scope === 'assignment' && timestamp && admissionDate) {
    const parsed = new Date(timestamp);
    const anchor = new Date(admissionDate);
    if (!Number.isNaN(parsed.getTime()) && !Number.isNaN(anchor.getTime())) {
      const minutes = Math.round((parsed.getTime() - anchor.getTime()) / (60 * 1000));
      if (minutes >= 0 && minutes <= MAX_DISPLAY_PRIOR_HOURS * 60) {
        return minutes === 0 ? 'During encounter' : `+${minutes} min`;
      }
    }
    return 'During encounter';
  }
  return scope === 'assignment' ? 'During encounter' : 'Prior to encounter';
};

export const clampToMinimumPrior = (
  timestamp: string | null | undefined,
  admissionDate?: string | null,
): string => {
  const floor = new Date(minimumPriorTimestamp(admissionDate));
  if (!timestamp) return floor.toISOString();
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > floor.getTime()) return floor.toISOString();
  return parsed.toISOString();
};

export const formatScenarioPrior = (
  timestamp: string | null | undefined,
  admissionDate?: string | null,
  relativeOffsetHours?: number | null,
): string => {
  if (relativeOffsetHours !== null && relativeOffsetHours !== undefined && Number.isFinite(relativeOffsetHours)) {
    return relativeOffsetHours <= 0 ? 'During encounter' : `${relativeOffsetHours} hours prior`;
  }
  // A legacy timestamp is audit data, not an authored relative offset. Never
  // infer a clinical age from it; reconciliation must explicitly author the
  // offset before it is shown to learners.
  void timestamp;
  void admissionDate;
  return 'Prior to encounter';
};
