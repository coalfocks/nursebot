import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261120090000_case_started_at.sql'), 'utf8');

// Static guard for the trigger contract. Behaviour is exercised by supabase/tests/case-started-at.integration.sql.
describe('case_started_at / completed_at trigger migration', () => {
  it('sets Case Start server-side in the same statement as the first transition to in_progress', () => {
    expect(sql).toMatch(/before insert or update on public\.student_room_assignments/i);
    expect(sql).toMatch(/new\.status = 'in_progress' and old\.status is distinct from 'in_progress'[\s\S]*new\.case_started_at := now\(\)/i);
  });
  it('makes Case Start immutable once set and ignores client-supplied values', () => {
    expect(sql).toMatch(/old\.case_started_at is not null[\s\S]*new\.case_started_at := old\.case_started_at/i);
    expect(sql).toMatch(/else\s+new\.case_started_at := null/i);
  });
  it('preserves the original completed_at on completed assignments', () => {
    expect(sql).toMatch(/old\.status = 'completed' and old\.completed_at is not null and new\.status = 'completed'[\s\S]*new\.completed_at := old\.completed_at/i);
  });
});
