import { describe, expect, it } from 'vitest';
import { classifySourceReadError } from './source-read-classification';

describe('source read error classification', () => {
  it('distinguishes a missing relation from an invalid projection', () => {
    expect(classifySourceReadError({ code: '42P01', message: 'relation "missing_archive" does not exist' }).category).toBe('missing_table');
    expect(classifySourceReadError({ code: '42703', message: 'column "recorded_at" does not exist' }).category).toBe('missing_column');
  });

  it('preserves denied and generic read failures', () => {
    expect(classifySourceReadError({ code: '42501', message: 'permission denied for table clinical_notes' })).toMatchObject({ category: 'denied', code: '42501' });
    expect(classifySourceReadError({ code: 'PGRST116', message: 'multiple rows returned' })).toMatchObject({ category: 'read_failed', code: 'PGRST116' });
  });
});
