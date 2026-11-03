import type { LabResult } from './types';
import { formatPriorOffsetHours, formatStudentRelativeTime } from './studentDisplayTime';

const hoursBetween = (newer: string, older: string) =>
  Math.round((new Date(newer).getTime() - new Date(older).getTime()) / 3_600_000);

export const formatLabRelativeTime = (time: string, referenceTime?: string | null) => {
  if (!referenceTime) return 'Not recorded';
  const deltaHours = hoursBetween(referenceTime, time);
  if (!Number.isFinite(deltaHours) || deltaHours <= 0) return 'Now';
  return `${deltaHours}h prior`;
};

export const formatLabColumnLabel = (time: string, labs: LabResult[], studentView = false, caseClock?: string | null) => {
  const atTime = labs.filter((lab) => (lab.collectionTime ?? lab.resultTime) === time);
  const isBaseline = atTime.length > 0 && atTime.every((lab) => (lab.overrideScope ?? 'baseline') === 'baseline');
  const runtimeTimes = labs
    .filter((lab) => (lab.overrideScope ?? 'baseline') !== 'baseline')
    .map((lab) => lab.collectionTime ?? lab.resultTime)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const runtimeReference = runtimeTimes[runtimeTimes.length - 1] ?? null;
  if (studentView) {
    const authoredOffset = atTime.find((lab) => lab.baselineRelativeOffsetHours !== null && lab.baselineRelativeOffsetHours !== undefined)?.baselineRelativeOffsetHours;
    return isBaseline ? `Baseline · ${authoredOffset === undefined ? 'Historical baseline' : formatPriorOffsetHours(authoredOffset)}` : formatStudentRelativeTime(time, caseClock);
  }
  if (isBaseline && !runtimeReference) return `Baseline · ${new Date(time).toLocaleString()}`;
  const relative = formatLabRelativeTime(time, runtimeReference ?? time);
  return isBaseline ? `Baseline · ${relative}` : relative;
};

/** datetime-local has no timezone; authored simulation timestamps are explicitly UTC. */
export const datetimeLocalToUtc = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid date/time');
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))).toISOString();
};
