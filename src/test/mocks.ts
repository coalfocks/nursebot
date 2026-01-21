import type { User } from '@supabase/supabase-js';
import type { Profile } from '../lib/roles';
import type { Database } from '../lib/database.types';

type DbProfile = Database['public']['Tables']['profiles']['Row'];

export const createMockUser = (overrides: Partial<User> = {}): User => {
  return {
    id: 'mock-user-id',
    email: 'test@example.com',
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    role: null,
    ...overrides,
  } as User;
};

export const createMockProfile = (overrides: Partial<DbProfile> = {}): DbProfile => {
  return {
    id: 'mock-profile-id',
    email: 'test@example.com',
    full_name: 'Test User',
    study_year: 3,
    is_admin: false,
    role: 'student',
    school_id: 'mock-school-id',
    phone_number: null,
    sms_consent: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
};

export const createMockAuthError = (message: string, status = 400): Error => {
  const error = new Error(message);
  (error as any).status = status;
  return error;
};
