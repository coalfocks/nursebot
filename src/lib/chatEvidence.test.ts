import { describe, expect, it } from 'vitest';
import { collectPersistedChatAssignmentIds } from './chatEvidence';

describe('persisted chat evidence lookup', () => {
  it('pages beyond the first 200 rows and retains later assignment IDs', async () => {
    const rows = [
      ...Array.from({ length: 200 }, () => ({ assignment_id: 'assignment-with-long-transcript' })),
      { assignment_id: 'assignment-on-page-two' },
    ];
    const calls: Array<[number, number]> = [];
    const ids = await collectPersistedChatAssignmentIds(
      ['assignment-with-long-transcript', 'assignment-on-page-two'],
      async (_batch, from, to) => {
        calls.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
    );
    expect(ids).toEqual(new Set(['assignment-with-long-transcript', 'assignment-on-page-two']));
    expect(calls).toEqual([[0, 199], [200, 399]]);
  });

  it('fails closed for an evidence query error instead of returning no evidence', async () => {
    await expect(collectPersistedChatAssignmentIds(
      ['assignment-1'],
      async () => ({ data: null, error: new Error('query unavailable') }),
    )).rejects.toThrow('query unavailable');
  });
});
