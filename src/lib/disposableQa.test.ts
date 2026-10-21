import { describe, expect, it } from 'vitest';
import { isAuthorizedDisposableQaLearner } from './disposableQa';

describe('disposable QA learner authorization', () => {
  it('allows only the explicit synthetic learner, not arbitrary students', () => {
    expect(isAuthorizedDisposableQaLearner({ id: '1b895dcc-d329-4b31-8735-2059b986ae96', role: 'student' })).toBe(true);
    expect(isAuthorizedDisposableQaLearner({ id: 'real-learner', role: 'student' })).toBe(false);
    expect(isAuthorizedDisposableQaLearner({ id: '1b895dcc-d329-4b31-8735-2059b986ae96', role: 'school_admin' })).toBe(false);
  });
});
