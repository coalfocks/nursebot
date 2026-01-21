import { describe, it, expect } from 'vitest';
import { isSuperAdmin, isSchoolAdmin, isTestUser, hasAdminAccess, isStudent } from './roles';
import type { Profile } from './roles';

describe('roles', () => {
  describe('isSuperAdmin', () => {
    it('returns true for super_admin role', () => {
      const profile: Profile = { id: '1', role: 'super_admin' } as Profile;
      expect(isSuperAdmin(profile)).toBe(true);
    });

    it('returns false for other roles', () => {
      const profile: Profile = { id: '1', role: 'school_admin' } as Profile;
      expect(isSuperAdmin(profile)).toBe(false);
    });

    it('returns false for null profile', () => {
      expect(isSuperAdmin(null)).toBe(false);
    });

    it('returns false for undefined profile', () => {
      expect(isSuperAdmin(undefined)).toBe(false);
    });
  });

  describe('isSchoolAdmin', () => {
    it('returns true for school_admin role', () => {
      const profile: Profile = { id: '1', role: 'school_admin' } as Profile;
      expect(isSchoolAdmin(profile)).toBe(true);
    });

    it('returns false for other roles', () => {
      const profile: Profile = { id: '1', role: 'super_admin' } as Profile;
      expect(isSchoolAdmin(profile)).toBe(false);
    });

    it('returns false for null profile', () => {
      expect(isSchoolAdmin(null)).toBe(false);
    });

    it('returns false for undefined profile', () => {
      expect(isSchoolAdmin(undefined)).toBe(false);
    });
  });

  describe('isTestUser', () => {
    it('returns true for test_user role', () => {
      const profile: Profile = { id: '1', role: 'test_user' } as Profile;
      expect(isTestUser(profile)).toBe(true);
    });

    it('returns false for other roles', () => {
      const profile: Profile = { id: '1', role: 'student' } as Profile;
      expect(isTestUser(profile)).toBe(false);
    });

    it('returns false for null profile', () => {
      expect(isTestUser(null)).toBe(false);
    });

    it('returns false for undefined profile', () => {
      expect(isTestUser(undefined)).toBe(false);
    });
  });

  describe('hasAdminAccess', () => {
    it('returns true for super_admin role', () => {
      const profile: Profile = { id: '1', role: 'super_admin' } as Profile;
      expect(hasAdminAccess(profile)).toBe(true);
    });

    it('returns true for school_admin role', () => {
      const profile: Profile = { id: '1', role: 'school_admin' } as Profile;
      expect(hasAdminAccess(profile)).toBe(true);
    });

    it('returns false for student role', () => {
      const profile: Profile = { id: '1', role: 'student' } as Profile;
      expect(hasAdminAccess(profile)).toBe(false);
    });

    it('returns false for null profile', () => {
      expect(hasAdminAccess(null)).toBe(false);
    });

    it('returns false for undefined profile', () => {
      expect(hasAdminAccess(undefined)).toBe(false);
    });
  });

  describe('isStudent', () => {
    it('returns true for student role', () => {
      const profile: Profile = { id: '1', role: 'student' } as Profile;
      expect(isStudent(profile)).toBe(true);
    });

    it('returns false for other roles', () => {
      const profile: Profile = { id: '1', role: 'super_admin' } as Profile;
      expect(isStudent(profile)).toBe(false);
    });

    it('returns false for null profile', () => {
      expect(isStudent(null)).toBe(false);
    });

    it('returns false for undefined profile', () => {
      expect(isStudent(undefined)).toBe(false);
    });
  });
});
