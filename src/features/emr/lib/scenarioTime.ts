export const MINIMUM_EMR_PRIOR_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;
const MAX_DISPLAY_PRIOR_HOURS = 2 * 365 * 24;

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
  if (scope === 'assignment' && timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
  }
  return formatScenarioPrior(timestamp, admissionDate, relativeOffsetHours);
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
    return relativeOffsetHours === 0 ? 'At encounter' : `${relativeOffsetHours} hours prior`;
  }
  const displayTimestamp = clampToMinimumPrior(timestamp, admissionDate);
  const encounter = resolveEncounterTime(admissionDate);
  const elapsedHours = Math.max(
    MINIMUM_EMR_PRIOR_HOURS,
    Math.floor((encounter.getTime() - new Date(displayTimestamp).getTime()) / HOUR_MS),
  );
  if (!Number.isFinite(elapsedHours) || elapsedHours > MAX_DISPLAY_PRIOR_HOURS) {
    return 'Prior to encounter';
  }
  return `${elapsedHours}h prior • ${new Date(displayTimestamp).toLocaleString()}`;
};
