import { describe, expect, it } from 'vitest';
import { describeSupabaseError } from './supabaseErrorDiagnostic';

describe('describeSupabaseError', () => {
  it('keeps structured RPC fields and bounds the safe description', () => {
    const diagnostic = describeSupabaseError({
      status: 400,
      code: 'P0001',
      message: 'MAR_STUDENT_ROOM_UNAVAILABLE',
      details: 'student is not eligible for room',
      hint: 'select an available room',
      headers: { authorization: 'must never be exposed' },
    });
    expect(diagnostic).toMatchObject({ status: 400, code: 'P0001', message: 'MAR_STUDENT_ROOM_UNAVAILABLE' });
    expect(diagnostic.description).toContain('details=student is not eligible for room');
    expect(diagnostic.description).not.toContain('authorization');
  });

  it('reads only bounded structured response fields from a function error context', () => {
    const diagnostic = describeSupabaseError({
      message: 'FunctionsHttpError',
      context: { response: { status: 500, code: 'LAB_GENERATION_FAILED', message: 'generation failed', details: 'retry later' } },
    });
    expect(diagnostic).toEqual(expect.objectContaining({
      status: 500,
      code: 'LAB_GENERATION_FAILED',
      message: 'FunctionsHttpError',
      details: 'retry later',
    }));
  });

  it('does not throw or expose arbitrary object content', () => {
    const diagnostic = describeSupabaseError(new Error('plain failure'));
    expect(diagnostic.description).toBe('message=plain failure');
    expect(describeSupabaseError(null).message).toBe('Unknown Supabase error');
  });
});
