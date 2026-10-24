import { describe, expect, it } from 'vitest';
import { resolveLegacyCaseProvenance } from './legacy-case-provenance';

const identity = { patientId: 'patient-1', schoolId: 'school-1', roomId: 7, pinnedCaseVersion: 'case-v1' };
const completedAt = '2026-10-24T00:00:00.000Z';

describe('legacy case provenance', () => {
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
});
