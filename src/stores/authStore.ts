import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  profile: any | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, studyYear: number) => Promise<void>;
  signOut: () => Promise<void>;
  loadUser: () => Promise<void>;
}

// Mock user data for development
const mockUser: User = {
  id: 'mock-user-id',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
  role: 'authenticated',
  updated_at: new Date().toISOString(),
};

const mockProfile = {
  id: mockUser.id,
  full_name: 'Test Student',
  study_year: 3,
  specialization_interest: 'Internal Medicine',
  is_admin: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const useAuthStore = create<AuthState>((set) => ({
  user: mockUser, // Set mock user as initial state
  profile: mockProfile, // Set mock profile as initial state
  loading: false, // Set loading to false initially
  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  },
  signUp: async (email, password, fullName, studyYear) => {
    const { data: { user }, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    if (!user) throw new Error('User creation failed');

    const { error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: user.id,
          full_name: fullName,
          study_year: studyYear,
        },
      ]);

    if (profileError) throw profileError;
  },
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    set({ user: null, profile: null });
  },
  loadUser: async () => {
    // For development, just set the mock data immediately
    set({ user: mockUser, profile: mockProfile, loading: false });
  },
}));