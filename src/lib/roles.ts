import type { Database } from './database.types';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export const isSuperAdmin = (profile: Profile | null | undefined): boolean =>
  profile?.role === 'super_admin';

export const isSchoolAdmin = (profile: Profile | null | undefined): boolean =>
  profile?.role === 'school_admin';

export const hasAdminAccess = (profile: Profile | null | undefined): boolean =>
  isSuperAdmin(profile) || isSchoolAdmin(profile);

export const isStudent = (profile: Profile | null | undefined): boolean =>
  profile?.role === 'student';
