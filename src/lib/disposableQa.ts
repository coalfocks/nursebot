/**
 * Explicit production allow-list for the superadmin-only disposable QA path.
 * This is deliberately narrower than profiles.role === 'student': real
 * learners must never be eligible for the MAR-unavailable escape hatch.
 */
export const AUTHORIZED_DISPOSABLE_QA_LEARNER_IDS = new Set([
  '1b895dcc-d329-4b31-8735-2059b986ae96',
]);

export const isAuthorizedDisposableQaLearner = (profile: { id?: string | null; role?: string | null } | null | undefined) =>
  profile?.role === 'student' && typeof profile.id === 'string' && AUTHORIZED_DISPOSABLE_QA_LEARNER_IDS.has(profile.id);
