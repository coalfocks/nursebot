import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

/**
 * Academic-year date policy for account-added filtering.
 * The academic year begins August 1 and ends July 31, expressed as UTC
 * calendar-day bounds. This is intentionally an account-created-date filter,
 * not an enrollment/cohort inference; a future membership field can model
 * enrollment separately.
 */
export const ACADEMIC_YEAR_START_MONTH = 8;
export const ACADEMIC_YEAR_START_DAY = 1;

export type StudentDateFilter =
  | { mode: 'all' }
  | { mode: 'academic_year'; startYear: number }
  | { mode: 'custom'; startDate: string; endDate: string };

export type DateBounds = { start: string; endExclusive: string };

const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

export const getAcademicYearStartYear = (date = new Date()) => {
  const month = date.getUTCMonth() + 1;
  return month >= ACADEMIC_YEAR_START_MONTH ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
};

export const getAcademicYearOptions = (date = new Date()) => {
  const currentStartYear = getAcademicYearStartYear(date);
  return [currentStartYear - 1, currentStartYear, currentStartYear + 1];
};

export const formatAcademicYear = (startYear: number) => `${startYear}–${startYear + 1}`;

export const getStudentDateBounds = (filter: StudentDateFilter): DateBounds | null => {
  if (filter.mode === 'all') return null;

  if (filter.mode === 'academic_year') {
    return {
      start: utcDate(filter.startYear, ACADEMIC_YEAR_START_MONTH, ACADEMIC_YEAR_START_DAY).toISOString(),
      endExclusive: utcDate(filter.startYear + 1, ACADEMIC_YEAR_START_MONTH, ACADEMIC_YEAR_START_DAY).toISOString(),
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(filter.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(filter.endDate)) return null;
  const start = new Date(`${filter.startDate}T00:00:00.000Z`);
  const end = new Date(`${filter.endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return { start: start.toISOString(), endExclusive: new Date(end.getTime() + 86_400_000).toISOString() };
};

export const isStudentDateFilterValid = (filter: StudentDateFilter) =>
  filter.mode === 'all' || getStudentDateBounds(filter) !== null;

export const matchesStudentDateFilter = (
  profile: Pick<Profile, 'created_at'>,
  filter: StudentDateFilter,
) => {
  if (filter.mode === 'all') return true;
  if (!profile.created_at) return false;
  const createdAt = new Date(profile.created_at);
  const bounds = getStudentDateBounds(filter);
  if (Number.isNaN(createdAt.getTime()) || !bounds) return false;
  return createdAt >= new Date(bounds.start) && createdAt < new Date(bounds.endExclusive);
};

export const getStudentDateFilterLabel = (filter: StudentDateFilter) => {
  if (filter.mode === 'all') return 'Added: All time';
  if (filter.mode === 'academic_year') return `Added during academic year ${formatAcademicYear(filter.startYear)}`;
  if (!isStudentDateFilterValid(filter)) return 'Added: Choose a valid date range';
  return `Added: ${filter.startDate} to ${filter.endDate}`;
};

/** Account age is not an assignment eligibility requirement. */
export const isAssignableStudentProfile = (profile: Pick<Profile, 'created_at'>) => Boolean(profile.created_at);
