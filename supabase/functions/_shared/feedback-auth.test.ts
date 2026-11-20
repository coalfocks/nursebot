import { describe, expect, it } from 'vitest';
import { canAdministerFeedback, canTriggerFeedback, resolveFeedbackCaller, type FeedbackCaller } from './feedback-auth';

const assignment = { student_id: 'stu-1', school_id: 'school-1' };
const caller = (over: Partial<FeedbackCaller>): FeedbackCaller => ({ userId: 'u', role: 'student', schoolId: 'school-1', isService: false, ...over });

describe('feedback caller scope', () => {
  it('lets a learner trigger only their own assignment, never run admin actions', () => {
    expect(canTriggerFeedback(caller({ userId: 'stu-1' }), assignment)).toBe(true);
    expect(canTriggerFeedback(caller({ userId: 'stu-2' }), assignment)).toBe(false);
    expect(canAdministerFeedback(caller({ userId: 'stu-1' }), assignment)).toBe(false);
  });
  it('limits school admins to their own school; super admins to any', () => {
    expect(canAdministerFeedback(caller({ role: 'school_admin' }), assignment)).toBe(true);
    expect(canAdministerFeedback(caller({ role: 'school_admin', schoolId: 'school-2' }), assignment)).toBe(false);
    expect(canAdministerFeedback(caller({ role: 'school_admin', schoolId: null }), { ...assignment, school_id: null })).toBe(false);
    expect(canAdministerFeedback(caller({ role: 'super_admin', schoolId: null }), assignment)).toBe(true);
    expect(canTriggerFeedback(caller({ role: 'school_admin', schoolId: 'school-2', userId: 'x' }), assignment)).toBe(false);
  });
  it('resolves callers from the bearer token, rejecting missing or invalid tokens', async () => {
    const client = {
      auth: { getUser: async (t: string) => (t === 'good' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: new Error('bad') }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'school_admin', school_id: 's1' } }) }) }) }),
    };
    expect(await resolveFeedbackCaller(client, null, 'svc')).toBeNull();
    expect(await resolveFeedbackCaller(client, 'Bearer nope', 'svc')).toBeNull();
    expect(await resolveFeedbackCaller(client, 'Bearer good', 'svc')).toEqual({ userId: 'u1', role: 'school_admin', schoolId: 's1', isService: false });
    expect((await resolveFeedbackCaller(client, 'Bearer svc', 'svc'))?.isService).toBe(true);
  });
});
