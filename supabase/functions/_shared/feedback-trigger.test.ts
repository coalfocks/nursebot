import { describe, expect, it } from 'vitest';
import { claimAssignmentFeedback, classifyClaim, STALE_PROCESSING_MS } from './feedback-trigger';

// Minimal in-memory model of the one conditional UPDATE the claim performs.
const makeClient = (rows: Record<string, { status: string; feedback_status: string; updated_at: string }>) => {
  const touched: string[] = [];
  const client = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const q: any = { id: '', needStatus: '', staleBefore: '' };
        const chain: any = {
          eq: (col: string, val: string) => { if (col === 'id') q.id = val; if (col === 'status') q.needStatus = val; return chain; },
          or: (expr: string) => { q.staleBefore = /updated_at\.lt\.([^)]+)\)/.exec(expr)![1]; return chain; },
          select: async () => {
            const row = rows[q.id];
            const claimable = row && row.status === q.needStatus && (row.feedback_status === 'pending' || (row.feedback_status === 'processing' && row.updated_at < q.staleBefore));
            if (!claimable) return { data: [], error: null };
            Object.assign(row, patch, { updated_at: new Date().toISOString() });
            touched.push(q.id);
            return { data: [{ id: q.id }], error: null };
          },
        };
        return chain;
      },
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows[id] ?? null, error: null }) }) }),
    }),
  };
  return { client, touched };
};
const now = Date.parse('2026-11-20T12:00:00Z');
const fresh = new Date(now - 1000).toISOString();

describe('scoped feedback claim', () => {
  it('claims a completed pending assignment exactly once', async () => {
    const { client, touched } = makeClient({ a: { status: 'completed', feedback_status: 'pending', updated_at: fresh } });
    expect(await claimAssignmentFeedback(client, 'a', now)).toBe('claimed');
    expect(await claimAssignmentFeedback(client, 'a', now)).toBe('in_flight');
    expect(touched).toEqual(['a']);
  });
  it('never touches another assignment', async () => {
    const { client, touched } = makeClient({ a: { status: 'completed', feedback_status: 'pending', updated_at: fresh }, b: { status: 'completed', feedback_status: 'pending', updated_at: fresh } });
    await claimAssignmentFeedback(client, 'a', now);
    expect(touched).toEqual(['a']);
  });
  it('does not claim incomplete, done or failed assignments', async () => {
    const { client, touched } = makeClient({
      inc: { status: 'in_progress', feedback_status: 'pending', updated_at: fresh },
      done: { status: 'completed', feedback_status: 'completed', updated_at: fresh },
      bad: { status: 'completed', feedback_status: 'failed', updated_at: fresh },
    });
    expect(await claimAssignmentFeedback(client, 'inc', now)).toBe('not_completed');
    expect(await claimAssignmentFeedback(client, 'done', now)).toBe('already_done');
    expect(await claimAssignmentFeedback(client, 'bad', now)).toBe('failed_needs_retry');
    expect(await claimAssignmentFeedback(client, 'missing', now)).toBe('not_found');
    expect(touched).toEqual([]);
  });
  it('re-claims a stale processing run (closed tab / dead worker) but not a fresh one', async () => {
    const stale = new Date(now - STALE_PROCESSING_MS - 1000).toISOString();
    const { client } = makeClient({ s: { status: 'completed', feedback_status: 'processing', updated_at: stale }, f: { status: 'completed', feedback_status: 'processing', updated_at: fresh } });
    expect(await claimAssignmentFeedback(client, 's', now)).toBe('claimed');
    expect(await claimAssignmentFeedback(client, 'f', now)).toBe('in_flight');
  });
  it('classifies rows for the UI/skip reason', () => {
    expect(classifyClaim(null)).toBe('not_found');
    expect(classifyClaim({ status: 'completed', feedback_status: 'pending' })).toBe('claimed');
  });
});
