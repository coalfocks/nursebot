// Caller authorization for generate-feedback modes that act on one assignment on behalf of a user.
// Legacy (mode-less) calls are unchanged. The functions run with the service role, so scope is checked here.

export type FeedbackCaller = { userId: string | null; role: string | null; schoolId: string | null; isService: boolean };
export type AssignmentScope = { student_id: string | null; school_id: string | null };

export const isAdminRole = (role: string | null | undefined) => role === 'super_admin' || role === 'school_admin';

/** Learner may act on their own assignment; admins on assignments in their school (super_admin: any). */
export const canTriggerFeedback = (caller: FeedbackCaller, assignment: AssignmentScope): boolean => {
  if (caller.isService) return true;
  if (caller.userId && assignment.student_id === caller.userId) return true;
  return canAdministerFeedback(caller, assignment);
};

/** Admin-only actions (compare rerun, promote). School admins are limited to their own school. */
export const canAdministerFeedback = (caller: FeedbackCaller, assignment: AssignmentScope): boolean => {
  if (caller.isService) return true;
  if (caller.role === 'super_admin') return true;
  return caller.role === 'school_admin' && Boolean(caller.schoolId) && caller.schoolId === assignment.school_id;
};

type AuthClient = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => any;
};

export const resolveFeedbackCaller = async (client: AuthClient, authorization: string | null, serviceRoleKey: string): Promise<FeedbackCaller | null> => {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  if (serviceRoleKey && token === serviceRoleKey) return { userId: null, role: null, schoolId: null, isService: true };
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await client.from('profiles').select('role, school_id').eq('id', data.user.id).maybeSingle();
  return { userId: data.user.id, role: profile?.role ?? null, schoolId: profile?.school_id ?? null, isService: false };
};
