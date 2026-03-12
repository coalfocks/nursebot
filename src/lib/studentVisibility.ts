import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export const ASSIGNABLE_STUDENT_LOOKBACK_MONTHS = 6;

export const getAssignableStudentCutoffDate = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - ASSIGNABLE_STUDENT_LOOKBACK_MONTHS);
  return cutoff;
};

export const isAssignableStudentProfile = (
  profile: Pick<Profile, 'created_at'>,
  now = new Date(),
) => {
  if (!profile.created_at) return false;
  const createdAt = new Date(profile.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;
  return createdAt >= getAssignableStudentCutoffDate(now);
};
