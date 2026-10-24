import { describe, expect, it, vi } from 'vitest';
import { authenticateFacultyStudyUser, isFacultyStudySuperAdmin, tokenClientOptions } from './faculty-study-auth';
import { studyActionAllowed } from './faculty-study-contract';

const request = (authorization?: string) => new Request('https://example.test', authorization ? { headers: { authorization } } : undefined);

describe('faculty study bearer authentication', () => {
  it('passes the exact bearer token to auth.getUser and disables session persistence', async () => {
    const accessToken = 'synthetic-token-without-rewriting';
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'admin-id' } }, error: null });
    const createTokenClient = vi.fn(() => ({ auth: { getUser } }));

    await expect(authenticateFacultyStudyUser(request(`Bearer ${accessToken}`), createTokenClient)).resolves.toBe('admin-id');
    expect(getUser).toHaveBeenCalledWith(accessToken);
    expect(createTokenClient).toHaveBeenCalledWith(tokenClientOptions(accessToken));
    expect(createTokenClient.mock.calls[0][0]).toEqual({
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it.each([
    ['missing authorization', request(), 'STUDY_AUTH_REQUIRED'],
    ['malformed authorization', request('Basic synthetic-token'), 'STUDY_AUTH_INVALID'],
    ['invalid token', request('Bearer synthetic-token'), 'STUDY_AUTH_INVALID'],
  ])('denies %s', async (_label, req, code) => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    await expect(authenticateFacultyStudyUser(req, () => ({ auth: { getUser } }))).rejects.toThrow(code);
    if (_label === 'missing authorization' || _label === 'malformed authorization') expect(getUser).not.toHaveBeenCalled();
  });

  it('keeps student denial and preflight-only read/write policy explicit', () => {
    expect(isFacultyStudySuperAdmin({ role: 'student' })).toBe(false);
    expect(isFacultyStudySuperAdmin({ role: 'super_admin' })).toBe(true);
    expect(studyActionAllowed('preflight', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('audit', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('prepare', 'preflight-only')).toBe(false);
    expect(studyActionAllowed('run', 'preflight-only')).toBe(false);
  });

  it('allows an authenticated read-only preflight action', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'super-admin-id' } }, error: null });
    await expect(authenticateFacultyStudyUser(request('Bearer preflight-token'), () => ({ auth: { getUser } }))).resolves.toBe('super-admin-id');
    expect(studyActionAllowed('preflight', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('export', 'preflight-only')).toBe(true);
  });
});
