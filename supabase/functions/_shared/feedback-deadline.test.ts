import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDeadline } from './feedback-deadline.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('feedback deadline lifecycle', () => {
  it('aborts outstanding work, identifies the pending section, and prevents a late write', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', transport);
    const deadline = new FeedbackDeadline(90);
    deadline.setPhase('model_evaluation');
    let complete!: () => void;
    const model = new Promise<void>((resolve) => { complete = resolve; });
    const lateWriteErrors: unknown[] = [];
    const result = deadline.run(async () => {
      await Promise.all([
        deadline.track('communication', async () => 'done'),
        deadline.track('medical_decision_making', () => model),
      ]);
      await deadline.fetch('https://example.test/grade', { method: 'POST' });
    });
    const rejection = expect(result).rejects.toThrow('pending=medical_decision_making');
    await vi.advanceTimersByTimeAsync(90);
    await rejection;
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut).toBe(true);
    expect(deadline.snapshot().operations.communication.status).toBe('completed');
    expect(deadline.snapshot().operations.medical_decision_making.status).toBe('pending');
    complete();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).not.toHaveBeenCalled();
    expect(deadline.snapshot().elapsed_ms).toBe(90);
    expect(deadline.snapshot().operations.medical_decision_making.status).toBe('pending');
    // Direct late persistence is also blocked, even if an upstream ignores cancellation.
    try { await deadline.fetch('https://example.test/grade', { method: 'POST' }); } catch (error) { lateWriteErrors.push(error); }
    expect(lateWriteErrors).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it('clears its timer after success and preserves the work result', async () => {
    vi.useFakeTimers();
    const deadline = new FeedbackDeadline(90);
    expect(await deadline.run(async () => 7)).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(deadline.timedOut).toBe(false);
  });

  it('preserves real operation errors and cancels sibling work on failure', async () => {
    const deadline = new FeedbackDeadline();
    await expect(deadline.run(() => deadline.track('commentary', async () => { throw new Error('provider unavailable'); }))).rejects.toThrow('provider unavailable');
    expect(deadline.timedOut).toBe(false);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.snapshot().operations.commentary.error).toBe('provider unavailable');
  });

  it('blocks writes when the clock passed the deadline even before the timer callback', () => {
    vi.useFakeTimers();
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    const deadline = new FeedbackDeadline(90);
    vi.setSystemTime(Date.now() + 91);
    expect(() => deadline.fetch('https://example.test/grade')).toThrow('Evaluation scoring timed out');
    expect(transport).not.toHaveBeenCalled();
  });
});
