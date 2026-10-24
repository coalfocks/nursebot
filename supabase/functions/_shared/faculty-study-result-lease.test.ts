import { describe, expect, it, vi } from 'vitest';
import { writeOwnedFacultyStudyResult, type FacultyStudyResultWrite } from './faculty-study-result-lease';

const write = (leaseToken: string, result: Record<string, unknown> | null, error: Record<string, unknown> | null = null): FacultyStudyResultWrite => ({
  batchId: 'batch-1',
  batchOrdinal: 1,
  leaseToken,
  assignmentId: '00000000-0000-4000-8000-000000000001',
  historicalSnapshot: { assignment_id: '00000000-0000-4000-8000-000000000001' },
  frozenInput: { source: leaseToken },
  result,
  canonicalResult: result,
  rawModelResponse: result,
  error,
  promptVersion: 'rubric-v4',
  model: 'study-model',
  generatedAt: result ? '2026-10-24T01:00:00.000Z' : null,
});

describe('faculty study result lease writes', () => {
  it('preserves the new owner result when an old worker resumes successfully', async () => {
    let currentLease = 'worker-a';
    let stored: FacultyStudyResultWrite | null = null;
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_lease_token !== currentLease) return { data: false, error: null };
      stored = write(String(args.p_lease_token), args.p_result as Record<string, unknown> | null, args.p_error as Record<string, unknown> | null);
      return { data: true, error: null };
    });
    const client = { rpc };

    await writeOwnedFacultyStudyResult(client, write('worker-a', null));
    currentLease = 'worker-b';
    await writeOwnedFacultyStudyResult(client, write('worker-b', { score: 5 }));

    await expect(writeOwnedFacultyStudyResult(client, write('worker-a', { score: 2 }))).rejects.toThrow('STUDY_RUN_LEASE_LOST');
    expect(stored?.leaseToken).toBe('worker-b');
    expect(stored?.frozenInput).toEqual({ source: 'worker-b' });
    expect(stored?.result).toEqual({ score: 5 });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('preserves the new owner success when an old worker resumes with an error', async () => {
    let currentLease = 'worker-a';
    let stored: FacultyStudyResultWrite | null = null;
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_lease_token !== currentLease) return { data: false, error: null };
      stored = write(String(args.p_lease_token), args.p_result as Record<string, unknown> | null, args.p_error as Record<string, unknown> | null);
      return { data: true, error: null };
    });
    const client = { rpc };

    await writeOwnedFacultyStudyResult(client, write('worker-a', null));
    currentLease = 'worker-b';
    await writeOwnedFacultyStudyResult(client, write('worker-b', { score: 5 }));

    await expect(writeOwnedFacultyStudyResult(client, write('worker-a', null, { code: 'MODEL_TIMEOUT' }))).rejects.toThrow('STUDY_RUN_LEASE_LOST');
    expect(stored?.leaseToken).toBe('worker-b');
    expect(stored?.frozenInput).toEqual({ source: 'worker-b' });
    expect(stored?.result).toEqual({ score: 5 });
    expect(stored?.error).toBeNull();
  });
});
