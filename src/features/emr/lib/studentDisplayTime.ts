const HOUR_MS = 3_600_000;

export const firstRuntimeTime = (timestamps: Array<string | null | undefined>) => {
  const valid = timestamps
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return valid[0] ?? null;
};

export const formatStudentRelativeTime = (value?: string | null, caseClock?: string | null) => {
  if (!value || !caseClock) return 'Now';
  const deltaHours = Math.round((Date.parse(caseClock) - Date.parse(value)) / HOUR_MS);
  if (!Number.isFinite(deltaHours) || deltaHours <= 0) return 'Now';
  if (deltaHours >= 24 && deltaHours % 24 === 0) {
    const days = deltaHours / 24;
    return `${days} day${days === 1 ? '' : 's'} prior`;
  }
  return `${deltaHours}h prior`;
};

