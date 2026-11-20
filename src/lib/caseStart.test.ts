import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  table: null as string | null,
  payload: null as unknown,
  eqArgs: [] as unknown[][],
  isArgs: [] as unknown[][],
  result: { error: null as unknown },
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      state.table = table;
      return {
        update: (payload: unknown) => {
          state.payload = payload;
          return {
            eq: (...args: unknown[]) => {
              state.eqArgs.push(args);
              return {
                is: (...isArgs: unknown[]) => {
                  state.isArgs.push(isArgs);
                  return Promise.resolve(state.result);
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { recordCaseStartOnce } from './caseStart';

describe('recordCaseStartOnce', () => {
  beforeEach(() => {
    state.table = null; state.payload = null; state.eqArgs = []; state.isArgs = []; state.result = { error: null };
  });

  it('writes only case_started_at, guarded so an existing start is never overwritten', async () => {
    await recordCaseStartOnce('assignment-1', '2026-11-20T10:00:00.000Z');
    expect(state.table).toBe('student_room_assignments');
    expect(state.payload).toEqual({ case_started_at: '2026-11-20T10:00:00.000Z' });
    expect(state.eqArgs).toEqual([['id', 'assignment-1']]);
    expect(state.isArgs).toEqual([['case_started_at', null]]);
  });

  it('surfaces database errors so the caller can log them', async () => {
    state.result = { error: new Error('column does not exist') };
    await expect(recordCaseStartOnce('assignment-1')).rejects.toThrow('column does not exist');
  });
});
