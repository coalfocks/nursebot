import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuthStore } from './authStore';
import { createMockUser, createMockProfile, createMockAuthError } from '../test/mocks';
import * as supabaseModule from '../lib/supabase';

// Mock Supabase client
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      getUser: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    from: vi.fn(),
  },
}));

describe('authStore', () => {
  let supabase: any;

  beforeEach(() => {
    supabase = supabaseModule.supabase;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('has correct initial state', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.user).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.activeSchoolId).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  describe('signIn', () => {
    it('successfully signs in with existing profile', async () => {
      const mockUser = createMockUser({ email: 'test@example.com' });
      const mockProfile = createMockProfile({
        id: mockUser.id,
        email: mockUser.email,
        role: 'student',
      });

      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockProfileQuery);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.activeSchoolId).toBe(mockProfile.school_id);
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });

    it('creates default profile when profile does not exist', async () => {
      const mockUser = createMockUser({ email: 'test@example.com' });
      const mockNewProfile = createMockProfile({
        id: mockUser.id,
        full_name: 'test',
        role: null,
      });

      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      // Profile not found (PGRST116)
      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockNewProfile,
          error: null,
        }),
      };

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
        insert: vi.fn().mockReturnValue(mockInsertQuery),
      };

      supabase.from.mockReturnValue(mockQueryBuilder);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.profile.role).toBe('student'); // Default applied
      expect(result.current.profile.full_name).toBe('test');
    });

    it('throws error on sign in failure', async () => {
      const mockError = createMockAuthError('Invalid login credentials');
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: mockError,
      });

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.signIn('test@example.com', 'wrong-password');
        })
      ).rejects.toThrow('Invalid login credentials');
    });
  });

  describe('signUp', () => {
    it('successfully signs up new user', async () => {
      const mockUser = createMockUser({ email: 'new@example.com' });
      const mockProfile = createMockProfile({
        id: mockUser.id,
        email: 'new@example.com',
        full_name: 'New User',
        study_year: 2,
        role: 'student',
        school_id: 'school-123',
      });

      supabase.auth.signUp.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      };

      const mockQueryBuilder = {
        insert: vi.fn().mockReturnValue(mockInsertQuery),
      };

      supabase.from.mockReturnValue(mockQueryBuilder);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.signUp(
          'new@example.com',
          'password123',
          'New User',
          2,
          'ER',
          null,
          false,
          'school-123'
        );
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.activeSchoolId).toBe('school-123');
    });

    it('throws error when user creation fails', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.signUp(
            'test@example.com',
            'password',
            'Test User',
            1,
            'ER',
            null,
            false,
            'school-123'
          );
        })
      ).rejects.toThrow('User creation failed');
    });
  });

  describe('signOut', () => {
    it('successfully signs out and clears state', async () => {
      const mockUser = createMockUser();

      supabase.auth.signOut.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useAuthStore());

      // Set initial state
      act(() => {
        useAuthStore.setState({ user: mockUser, profile: createMockProfile(), activeSchoolId: 'school-123' });
      });

      expect(result.current.user).toEqual(mockUser);

      await act(async () => {
        await result.current.signOut();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.activeSchoolId).toBeNull();
    });

    it('throws error on sign out failure', async () => {
      const mockError = createMockAuthError('Sign out failed');
      supabase.auth.signOut.mockResolvedValue({ error: mockError });

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.signOut();
        })
      ).rejects.toThrow('Sign out failed');
    });
  });

  describe('loadUser', () => {
    it('loads user when session exists', async () => {
      const mockUser = createMockUser();
      const mockProfile = createMockProfile();

      supabase.auth.getSession.mockResolvedValue({
        data: { session: { user: mockUser, access_token: 'token' } },
        error: null,
      });

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockProfileQuery);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.loadUser();
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.loading).toBe(false);
    });

    it('clears state when no session exists', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const { result } = renderHook(() => useAuthStore());

      // Set initial state
      act(() => {
        useAuthStore.setState({
          user: createMockUser(),
          profile: createMockProfile(),
          activeSchoolId: 'school-123',
        });
      });

      await act(async () => {
        await result.current.loadUser();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.activeSchoolId).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('creates default profile when loading user without profile', async () => {
      const mockUser = createMockUser({ email: 'notfound@example.com' });
      const mockNewProfile = createMockProfile({
        id: mockUser.id,
        full_name: 'notfound',
        role: null,
      });

      supabase.auth.getSession.mockResolvedValue({
        data: { session: { user: mockUser, access_token: 'token' } },
        error: null,
      });

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockInsertQuery = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockNewProfile,
          error: null,
        }),
      };

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
        insert: vi.fn().mockReturnValue(mockInsertQuery),
      };

      supabase.from.mockReturnValue(mockQueryBuilder);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.loadUser();
      });

      expect(result.current.profile.role).toBe('student'); // Default applied
      expect(result.current.loading).toBe(false);
    });
  });

  describe('setActiveSchoolId', () => {
    it('updates active school ID', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setActiveSchoolId('new-school-id');
      });

      expect(result.current.activeSchoolId).toBe('new-school-id');

      act(() => {
        result.current.setActiveSchoolId(null);
      });

      expect(result.current.activeSchoolId).toBeNull();
    });
  });

  describe('resetPassword', () => {
    it('successfully sends reset password email', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.resetPassword('test@example.com');
      });

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
        { redirectTo: `${window.location.origin}/reset-password` }
      );
    });

    it('throws error on reset password failure', async () => {
      const mockError = createMockAuthError('User not found');
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: mockError });

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.resetPassword('notfound@example.com');
        })
      ).rejects.toThrow('User not found');
    });
  });

  describe('withProfileDefaults', () => {
    it('applies default role when null', async () => {
      const mockUser = createMockUser();
      const mockProfileWithoutRole = createMockProfile({ role: null });

      supabase.auth.getSession.mockResolvedValue({
        data: { session: { user: mockUser, access_token: 'token' } },
        error: null,
      });

      supabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockProfileWithoutRole,
          error: null,
        }),
      };
      supabase.from.mockReturnValue(mockProfileQuery);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.loadUser();
      });

      expect(result.current.profile.role).toBe('student');
    });
  });
});
