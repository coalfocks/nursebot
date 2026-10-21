export const AUTHORIZED_DISPOSABLE_QA_LEARNER_IDS = new Set([
  '1b895dcc-d329-4b31-8735-2059b986ae96',
]);

export const isAuthorizedDisposableQaLearner = (id: string | null | undefined) =>
  typeof id === 'string' && AUTHORIZED_DISPOSABLE_QA_LEARNER_IDS.has(id);
