import { describe, expect, it } from 'vitest';
import { buildAssignmentListQuery } from './assignmentQueries';

function createQuerySpy() {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    select(columns: string) {
      calls.push(['select', columns]);
      return query;
    },
    eq(column: string, value: string | boolean) {
      calls.push(['eq', column, value]);
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.push(['order', column, options]);
      return query;
    },
    then: () => Promise.resolve({ data: [], error: null }).then,
  };
  return { client: { from: () => query }, calls };
}

describe('buildAssignmentListQuery', () => {
  it('builds an all-schools superadmin query with chainable filters', () => {
    const { client, calls } = createQuerySpy();

    buildAssignmentListQuery(client, null);

    expect(calls.map(([name]) => name)).toEqual(['select', 'eq', 'order']);
    expect(calls).toContainEqual(['eq', 'is_sandbox', false]);
    expect(calls.some(([, column]) => column === 'school_id')).toBe(false);
  });

  it('applies the one-school scope after select without awaiting the builder', () => {
    const { client, calls } = createQuerySpy();

    buildAssignmentListQuery(client, 'school-ua');

    expect(calls.map(([name]) => name)).toEqual(['select', 'eq', 'order', 'eq']);
    expect(calls).toContainEqual(['eq', 'is_sandbox', false]);
    expect(calls).toContainEqual(['eq', 'school_id', 'school-ua']);
  });
});
