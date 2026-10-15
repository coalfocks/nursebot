import { describe, expect, it, vi } from 'vitest';
import { runCaseGeneration } from './caseGeneration';

describe('runCaseGeneration', () => {
  it('persists generating before invoking and preserves failure state after timeout', async () => {
    const statuses: Array<[string, string | null]> = [];
    const invoke = vi.fn(
      () => new Promise<never>(() => undefined),
    );

    await expect(
      runCaseGeneration({
        timeoutMs: 5,
        invoke,
        persistStatus: async (status, error) => {
          statuses.push([status, error]);
        },
        persistSuccess: async () => undefined,
      }),
    ).rejects.toThrow('timed out');

    expect(statuses[0]).toEqual(['generating', null]);
    expect(statuses[1][0]).toBe('failed');
    expect(statuses[1][1]).toContain('Existing generated content was preserved.');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('does not replace the package when persistence fails after invocation', async () => {
    const statuses: string[] = [];
    const persistSuccess = vi.fn(async () => {
      throw new Error('database update failed');
    });

    await expect(
      runCaseGeneration({
        invoke: async () => ({ data: { package: { patient: {} } }, error: null }),
        persistStatus: async (status) => {
          statuses.push(status);
        },
        persistSuccess,
      }),
    ).rejects.toThrow('database update failed');

    expect(persistSuccess).toHaveBeenCalledOnce();
    expect(statuses).toEqual(['generating', 'failed']);
  });
});
