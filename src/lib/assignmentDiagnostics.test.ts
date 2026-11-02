import { describe, expect, it } from 'vitest';
import { normalizeAssignmentDiagnostic } from './assignmentDiagnostics';

describe('assignment diagnostics', () => {
  it('preserves Supabase fields and HTTP status without flattening the error', () => {
    const error = {
      code: '42501',
      message: 'permission denied',
      details: 'row policy rejected the request',
      hint: 'check school scope',
      status: 403,
    };
    expect(normalizeAssignmentDiagnostic(error, 'publication per room', 'RPC publish_mar_case_version_from_manual_packet', 'write')).toEqual({
      phase: 'publication per room',
      boundary: 'RPC publish_mar_case_version_from_manual_packet',
      code: '42501',
      message: 'permission denied',
      details: 'row policy rejected the request',
      hint: 'check school scope',
      status: 403,
      classification: 'response-loss/unknown-commit',
    });
  });

  it('classifies a deterministic MAR guard as confirmed pre-write', () => {
    const diagnostic = normalizeAssignmentDiagnostic(
      { code: 'MAR_SCHOOL_SCOPE_MISMATCH', message: 'wrong school' },
      'materialization per assignment',
      'RPC create_assignment_with_mar_materialization',
      'write',
    );
    expect(diagnostic.classification).toBe('confirmed pre-write');
  });

  it('recognizes a MAR guard carried in the RPC message beside SQLSTATE P0001', () => {
    const diagnostic = normalizeAssignmentDiagnostic(
      { code: 'P0001', message: 'MAR_STUDENT_SCHOOL_MISMATCH' },
      'materialization per assignment',
      'RPC create_assignment_with_mar_materialization',
      'write',
    );
    expect(diagnostic.classification).toBe('confirmed pre-write');
  });

  it('classifies a failed write without a guard as unknown commit', () => {
    expect(normalizeAssignmentDiagnostic(
      new Error('network connection closed'),
      'materialization per assignment',
      'RPC create_assignment_with_mar_materialization',
      'write',
    ).classification).toBe('response-loss/unknown-commit');
  });
});
