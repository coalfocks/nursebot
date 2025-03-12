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
  resetPassword: (email: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  loading: true,
  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) throw error;
    
    // Fetch user profile after successful login
    if (data.user) {
      // Only fetch the specific user's profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      
      // If profile doesn't exist, create one
      if (profileError && profileError.code === 'PGRST116') {
        // Extract name from email (everything before @)
        const defaultName = email.split('@')[0];
        
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
          .insert([
            {
              id: data.user.id,
              full_name: defaultName,
              study_year: 1,
              is_admin: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();
        
        if (createError) throw createError;
        set({ user: data.user, profile: newProfile });
        return;
      }
      
      if (profileError) throw profileError;
      
      set({ user: data.user, profile: profileData });
    }
  },
  signUp: async (email, password, fullName, studyYear) => {
    const { data: { user }, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    if (!user) throw new Error('User creation failed');

    // Create user profile with student role (is_admin = false)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: user.id,
          full_name: fullName,
          study_year: studyYear,
          is_admin: false, // Default to student role
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (profileError) throw profileError;
    
    set({ user, profile: profileData });
  },
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    set({ user: null, profile: null });
  },
  resetPassword: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },
  loadUser: async () => {
    set({ loading: true });
    
    // Get current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error(sessionError);
      set({ loading: false });
      return;
    }
    
    if (!session) {
      set({ user: null, profile: null, loading: false });
      return;
    }
    
    // Get user from session
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error(userError);
      set({ loading: false });
      return;
    }
    
    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    // If profile doesn't exist, create one
    if (profileError && profileError.code === 'PGRST116') {
      // Extract name from email (everything before @)
      const defaultName = user.email?.split('@')[0] || 'User';
      
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert([
          {
            id: user.id,
            full_name: defaultName,
            study_year: 1,
            is_admin: false,
            phone_number: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();
      
      if (createError) {
        console.error(createError);
        set({ user, profile: null, loading: false });
        return;
      }
      
      set({ user, profile: newProfile, loading: false });
      return;
    }
    
    if (profileError) {
      console.error(profileError);
      set({ user, profile: null, loading: false });
      return;
    }
    
    set({ user, profile, loading: false });
  },
}));