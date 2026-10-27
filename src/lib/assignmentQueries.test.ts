import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_LIST_PAGE_SIZE, fetchAssignmentList } from './assignmentQueries';

describe('fetchAssignmentList', () => {
  it('fetches the second page when the list exceeds the REST row cap', async () => {
    const ranges: Array<[number, number]> = [];
    const pages = [
      Array.from({ length: ASSIGNMENT_LIST_PAGE_SIZE }, (_, index) => ({ id: `assignment-${index}` })),
      Array.from({ length: ASSIGNMENT_LIST_PAGE_SIZE }, (_, index) => ({ id: `assignment-${index + 1000}` })),
      [],
    ];
    let request = 0;
    const query = {
      select: () => query,
      order: () => query,
      eq: () => query,
      range: async (from: number, to: number) => {
        ranges.push([from, to]);
        return { data: pages[request++], error: null };
      },
    };
    const client = { from: () => query };

    const rows = await fetchAssignmentList(client as never, 'school-1');

    expect(rows).toHaveLength(2000);
    expect(rows.at(-1)).toEqual({ id: 'assignment-1999' });
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('preserves the school scope on every page query', async () => {
    const scopedSchools: string[] = [];
    const query = {
      select: () => query,
      order: () => query,
      eq: (column: string, value: string) => {
        if (column === 'school_id') scopedSchools.push(value);
        return query;
      },
      range: async () => ({ data: [{ id: 'assignment-1' }], error: null }),
    };

    await fetchAssignmentList({ from: () => query } as never, 'school-1');

    expect(scopedSchools).toEqual(['school-1']);
  });
});
