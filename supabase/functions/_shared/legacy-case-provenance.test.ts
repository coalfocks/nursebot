import { describe, expect, it } from 'vitest';
import { resolveLegacyCaseProvenance } from './legacy-case-provenance';
import { classifyHistoricalNoteCandidates } from './legacy-case-provenance';

const identity = { patientId: 'patient-1', schoolId: 'school-1', roomId: 7, pinnedCaseVersion: 'case-v1', identityProvenance: 'assignment' as const };
const completedAt = '2026-10-24T00:00:00.000Z';

describe('legacy case provenance', () => {
  it('keeps post-completion, deleted, metadata-only, and mismatched notes as candidates but not proof', () => {
    const result = classifyHistoricalNoteCandidates([
      { id: 'post', assignment_id: 'assignment-1', patient_id: 'patient-1', school_id: 'school-1', override_scope: 'assignment', content: 'later', created_at: '2026-10-24T01:00:00.000Z', updated_at: '2026-10-24T01:00:00.000Z' },
      { id: 'deleted', assignment_id: 'assignment-1', patient_id: 'patient-1', school_id: 'school-1', override_scope: 'assignment', content: 'old', created_at: '2026-10-23T00:00:00.000Z', deleted_at: '2026-10-23T12:00:00.000Z' },
      { id: 'hash-only', assignment_id: 'assignment-1', patient_id: 'patient-1', school_id: 'school-1', override_scope: 'assignment', content: '', content_hash: 'abc', created_at: '2026-10-23T00:00:00.000Z' },
      { id: 'verified', assignment_id: 'assignment-1', patient_id: 'patient-1', school_id: 'school-1', override_scope: 'assignment', content: 'completion-time note', created_at: '2026-10-23T00:00:00.000Z', updated_at: '2026-10-23T00:00:00.000Z' },
    ], completedAt, { assignmentId: 'assignment-1', patientId: 'patient-1', schoolId: 'school-1' });
    expect(result.candidates).toHaveLength(4);
    expect(result.verified.map((row) => row.source_id)).toEqual(['verified']);
    expect(result.candidates.find((row) => row.source_id === 'post')?.verification_gaps).toContain('created_after_completion');
    expect(result.candidates.find((row) => row.source_id === 'deleted')?.verification_gaps).toContain('deleted_before_or_at_completion');
    expect(result.candidates.find((row) => row.source_id === 'hash-only')?.verification_gaps).toContain('historical_content_unavailable');
  });

  it('excludes a same-room archive belonging to another patient or school', () => {
    const result = resolveLegacyCaseProvenance({
      identity,
      completedAt,
      hasFullScenarioBaseline: false,
      assignmentRows: [{ assignment_id: 'assignment-1', case_version: 'case-v1', patient_id: 'other-patient', room_id: 7, created_at: '2026-10-23T00:00:00.000Z' }],
      authoredRows: [{ room_id: 7, patient_id: 'patient-1', school_id: 'other-school', case_version: 'case-v1', created_at: '2026-10-23T00:00:00.000Z' }],
    });
    expect(result.assignment_baseline_version).toBeNull();
    expect(result.authored_case_version).toBeNull();
    expect(result.identity_excluded_references).toHaveLength(2);
    expect(result.missing_history_flags).toContain('archive_identity_mismatch_excluded');
    expect(result.missing_history_flags).toContain('historical_full_case_source_missing');
  });

  it('keeps the pinned assignment version authoritative and flags an authored conflict', () => {
    const result = resolveLegacyCaseProvenance({
      identity,
      completedAt,
      hasFullScenarioBaseline: false,
      assignmentRows: [{ assignment_id: 'assignment-1', case_version: 'case-v1', patient_id: 'patient-1', room_id: 7, created_at: '2026-10-23T00:00:00.000Z' }],
      authoredRows: [{ room_id: 7, patient_id: 'patient-1', school_id: 'school-1', case_version: 'case-v2', created_at: '2026-10-23T00:00:00.000Z' }],
    });
    expect(result.resolved_case_version).toBe('case-v1');
    expect(result.selected_source).toBe('mar_assignment_baseline_versions_partial');
    expect(result.assignment_baseline_version?.case_version).toBe('case-v1');
    expect(result.authored_case_version?.case_version).toBe('case-v2');
    expect(result.missing_history_flags).toContain('case_lineage_conflict_pinned_assignment_over_authored');
    expect(result.missing_history_flags).toContain('mar_archive_partial_only_orders_events_not_full_chart');
    expect(result.references.find((reference) => reference.case_version === 'case-v2')?.usable_at_completion).toBe(false);
  });

  it('reports a full assignment scenario baseline separately from partial MAR evidence', () => {
    const result = resolveLegacyCaseProvenance({
      identity,
      completedAt,
      hasFullScenarioBaseline: true,
      assignmentRows: [],
      authoredRows: [],
    });
    expect(result.full_case_source_available).toBe(true);
    expect(result.selected_source).toBe('student_room_assignments.scenario_baseline');
    expect(result.archive_content_scope).toBe('full_assignment_scenario_baseline');
    expect(result.missing_history_flags).not.toContain('historical_full_case_source_missing');
  });

  it('does not treat authored v2 as a recovery for an explicit pinned v1', () => {
    const result = resolveLegacyCaseProvenance({
      identity,
      completedAt,
      hasFullScenarioBaseline: false,
      assignmentRows: [],
      authoredRows: [{ room_id: 7, patient_id: 'patient-1', school_id: 'school-1', case_version: 'case-v2', created_at: '2026-10-23T00:00:00.000Z' }],
    });
    expect(result.authored_case_version?.case_version).toBe('case-v2');
    expect(result.authored_case_version?.usable_at_completion).toBe(false);
    expect(result.resolved_case_version).toBeNull();
    expect(result.missing_history_flags).toContain('case_version_source_mismatch_pinned_assignment_archive_missing');
  });

  it('does not use the joined room when assignment identity is absent', () => {
    const result = resolveLegacyCaseProvenance({
      identity: { patientId: null, schoolId: null, roomId: 7, pinnedCaseVersion: 'case-v1', identityProvenance: 'missing' },
      completedAt,
      hasFullScenarioBaseline: false,
      assignmentRows: [{ assignment_id: 'assignment-1', case_version: 'case-v1', patient_id: 'historical-patient', room_id: 7, created_at: '2026-10-23T00:00:00.000Z' }],
      authoredRows: [],
    });
    expect(result.assignment_baseline_version?.case_version).toBe('case-v1');
    expect(result.assignment_baseline_version?.usable_at_completion).toBe(false);
    expect(result.resolved_case_version).toBeNull();
    expect(result.missing_history_flags).toContain('historical_assignment_identity_unresolved');
  });
});
