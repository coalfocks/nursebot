import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as string[], rows: [] as Array<{ id: string }> }));

vi.mock('./supabase', () => {
  const query = {
    select(...args: unknown[]) { state.calls.push(`select:${args.join(',')}`); return query; },
    eq(column: string, value: unknown) { state.calls.push(`eq:${column}=${String(value)}`); return query; },
    in(column: string, values: unknown[]) { state.calls.push(`in:${column}:${JSON.stringify(values)}`); return query; },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: state.rows, error: null }).then(resolve, reject);
    },
  };
  return { supabase: { from: (table: string) => { state.calls.push(`from:${table}`); return query; } } };
});

import { checkPendingFeedback } from './feedbackService';

const SCOPED = '11111111-1111-4111-8111-111111111111';

describe('checkPendingFeedback scope', () => {
  beforeEach(() => { state.calls = []; state.rows = []; });

  it('queries all pending completed assignments when no allowlist is given (legacy scope)', async () => {
    await checkPendingFeedback();
    expect(state.calls).toEqual(['from:student_room_assignments', 'select:id', 'eq:feedback_status=pending', 'eq:status=completed']);
  });

  it('restricts the query to allowlisted assignment IDs when a scope is given', async () => {
    await checkPendingFeedback({ assignmentIds: [SCOPED] });
    expect(state.calls).toContain(`in:id:${JSON.stringify([SCOPED])}`);
  });

  it('touches nothing when the allowlist is empty', async () => {
    await checkPendingFeedback({ assignmentIds: [] });
    expect(state.calls).toEqual([]);
  });
});
