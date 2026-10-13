export const MINIMUM_EMR_PRIOR_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

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
): string => {
  const displayTimestamp = clampToMinimumPrior(timestamp, admissionDate);
  const encounter = resolveEncounterTime(admissionDate);
  const elapsedHours = Math.max(
    MINIMUM_EMR_PRIOR_HOURS,
    Math.floor((encounter.getTime() - new Date(displayTimestamp).getTime()) / HOUR_MS),
  );
  return `${elapsedHours}h prior • ${new Date(displayTimestamp).toLocaleString()}`;
};
