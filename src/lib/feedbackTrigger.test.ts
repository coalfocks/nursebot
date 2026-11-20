import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), updates: [] as any[], updateError: null as unknown }));
vi.mock('./supabase', () => {
  const chain: any = { eq: (col: string, val: unknown) => { chain.filters.push([col, val]); return chain; }, filters: [] as unknown[], then: (resolve: any) => resolve({ error: mocks.updateError }) };
  return { supabase: { functions: { invoke: mocks.invoke }, from: () => ({ update: (patch: unknown) => { chain.filters = []; mocks.updates.push({ patch, chain }); return chain; } }) } };
});

import { feedbackUiState, requestAutoFeedback, retryFailedFeedback, shouldResumeFeedback } from './feedbackTrigger';

describe('feedback UI state', () => {
  it('maps assignment fields to none/pending/done/failed', () => {
    expect(feedbackUiState({ status: 'in_progress', feedback_status: 'pending' })).toBe('none');
    expect(feedbackUiState({ status: 'completed', feedback_status: 'pending' })).toBe('pending');
    expect(feedbackUiState({ status: 'completed', feedback_status: 'processing' })).toBe('pending');
    expect(feedbackUiState({ status: 'completed', feedback_status: 'completed' })).toBe('done');
    expect(feedbackUiState({ status: 'completed', feedback_status: 'failed' })).toBe('failed');
    expect(feedbackUiState(null)).toBe('none');
  });
  it('resumes only completed assignments still waiting on feedback', () => {
    expect(shouldResumeFeedback({ status: 'completed', feedback_status: 'pending' })).toBe(true);
    expect(shouldResumeFeedback({ status: 'completed', feedback_status: 'processing' })).toBe(true);
    expect(shouldResumeFeedback({ status: 'completed', feedback_status: 'completed' })).toBe(false);
    expect(shouldResumeFeedback({ status: 'completed', feedback_status: 'failed' })).toBe(false);
    expect(shouldResumeFeedback({ status: 'in_progress', feedback_status: 'pending' })).toBe(false);
  });
});

describe('requestAutoFeedback', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.updates.length = 0; mocks.updateError = null; });
  it('sends exactly one assignment ID in scoped auto mode', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true, accepted: true }, error: null });
    await expect(requestAutoFeedback('a-1')).resolves.toEqual({ accepted: true, skipped: undefined });
    expect(mocks.invoke).toHaveBeenCalledWith('generate-feedback', { body: { assignmentId: 'a-1', mode: 'auto' } });
  });
  it('reports a server-side skip (already running or done) without error', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true, skipped: 'in_flight' }, error: null });
    await expect(requestAutoFeedback('a-1')).resolves.toEqual({ accepted: false, skipped: 'in_flight' });
  });
  it('surfaces the server error message on failure', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ error: 'Not allowed for this assignment' }), { status: 403 }) }) });
    await expect(requestAutoFeedback('a-1')).rejects.toThrow('Not allowed for this assignment');
  });
});

describe('retryFailedFeedback', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.updates.length = 0; mocks.updateError = null; });
  it('re-queues only this assignment, only if completed and failed, then requests generation', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true, accepted: true }, error: null });
    await retryFailedFeedback('a-9');
    expect(mocks.updates[0].patch).toEqual({ feedback_status: 'pending', feedback_error: null });
    expect(mocks.updates[0].chain.filters).toEqual([['id', 'a-9'], ['status', 'completed'], ['feedback_status', 'failed']]);
    expect(mocks.invoke).toHaveBeenCalledWith('generate-feedback', { body: { assignmentId: 'a-9', mode: 'auto' } });
  });
  it('does not call the function if the re-queue update fails', async () => {
    mocks.updateError = new Error('rls');
    await expect(retryFailedFeedback('a-9')).rejects.toThrow('rls');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
