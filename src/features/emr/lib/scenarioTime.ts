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

/** Baseline records are intentionally rendered as relative history. Learner
 * attempt records must retain their actual collection/encounter time. */
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

/** Render a recorded clinical timestamp without deriving an ordinal age from
 * the encounter clock. Relative offsets are meaningful only when the record
 * explicitly carries one, so they are appended as context rather than
 * replacing the stored date/time. */
export const formatRecordedEmrTimestamp = (
  timestamp: string | null | undefined,
  relativeOffsetHours?: number | null,
): string => {
  if (!timestamp) return 'Time unavailable';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';

  const recorded = parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
  if (relativeOffsetHours === null || relativeOffsetHours === undefined || !Number.isFinite(relativeOffsetHours)) {
    return recorded;
  }
  return `${recorded} • ${relativeOffsetHours === 0 ? 'at encounter' : `${relativeOffsetHours}h prior`}`;
};

/** Learner-facing time labels never expose authored calendar timestamps. */
export const formatLearnerEmrTime = (
  timestamp: string | null | undefined,
  admissionDate?: string | null,
  relativeOffsetHours?: number | null,
): string => {
  if (relativeOffsetHours !== null && relativeOffsetHours !== undefined && Number.isFinite(relativeOffsetHours)) {
    return relativeOffsetHours === 0 ? 'Now' : `${relativeOffsetHours} hours prior`;
  }

  const parsed = timestamp ? new Date(timestamp) : null;
  const encounter = resolveEncounterTime(admissionDate);
  if (!parsed || Number.isNaN(parsed.getTime())) return 'Time unavailable';
  const elapsedHours = Math.max(0, Math.floor((encounter.getTime() - parsed.getTime()) / HOUR_MS));
  if (!Number.isFinite(elapsedHours) || elapsedHours === 0) return 'Now';
  if (elapsedHours > MAX_DISPLAY_PRIOR_HOURS) return 'Prior to encounter';
  return `${elapsedHours} hours prior`;
};
