import { describe, expect, it } from 'vitest';
import { resolveFailedConsultantRequestClaim } from './consultant-request-claim';

describe('failed consultant request claims', () => {
  it('assigns ownership only when the conditional update returns exactly one row', () => {
    const row = { id: 'request-a' };
    expect(resolveFailedConsultantRequestClaim([row])).toEqual({ claimed: true, row });
    expect(resolveFailedConsultantRequestClaim([])).toEqual({ claimed: false, row: null });
  });

  it('rejects an impossible multi-row claim instead of assigning ambiguous ownership', () => {
    expect(() => resolveFailedConsultantRequestClaim([{ id: 'request-a' }, { id: 'request-b' }])).toThrow('more than one row');
  });
});
