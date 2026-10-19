import { describe, expect, it } from 'vitest';
import { buildConsultantOrderLookup, decideConsultantOrderPersistence } from './consultant-order';

describe('consultant order persistence', () => {
  it('queries the one active assignment-scoped order for the exact consultant episode', () => {
    expect(buildConsultantOrderLookup({ assignmentId: 'assignment-a', audience: 'adult', specialty: 'Medicine' })).toEqual({
      assignmentId: 'assignment-a',
      audience: 'adult',
      specialty: 'Medicine',
      category: 'Consult',
      overrideScope: 'assignment',
      status: 'Active',
      deletedAt: null,
    });
  });

  it('reuses an existing matching order and only creates when the lookup is empty', () => {
    const existing = { id: 'order-a' };
    expect(decideConsultantOrderPersistence(existing)).toEqual({ action: 'reuse', order: existing });
    expect(decideConsultantOrderPersistence(null)).toEqual({ action: 'create' });
  });
});
