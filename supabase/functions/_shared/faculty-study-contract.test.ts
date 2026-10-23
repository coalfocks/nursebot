import { describe, expect, it } from 'vitest';
import { csvEscape, deidentifyStudyResult, snapshotAssignmentProtection, STUDY_ASSIGNMENT_PROTECTED_FIELDS, STUDY_SHEET_COLUMNS, studySheetRow, validateStudyManifest } from './faculty-study-contract';

const attempts = Array.from({ length: 30 }, (_, index) => ({ case_number: index + 1, assignment_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
const manifest = { batch_key: 'faculty-oct-2026', prompt_version: 'revised-v4', prompt_text: 'Evaluate only the frozen historical attempt.', expected_model: 'gpt-6-luna', attempts };

describe('faculty study contract', () => {
  it('requires the fixed ordered 30-case manifest', () => {
    expect(validateStudyManifest(manifest).attempts).toHaveLength(30);
    expect(() => validateStudyManifest({ ...manifest, attempts: attempts.slice(1) })).toThrow('exactly 30');
    expect(() => validateStudyManifest({ ...manifest, attempts: [...attempts].reverse() })).toThrow('1 through 30 in order');
  });

  it('rejects duplicate assignments and malformed ids', () => {
    expect(() => validateStudyManifest({ ...manifest, attempts: attempts.map((item, i) => i === 1 ? { ...item, assignment_id: attempts[0].assignment_id } : item) })).toThrow('unique');
    expect(() => validateStudyManifest({ ...manifest, attempts: [{ ...attempts[0], assignment_id: 'not-an-id' }, ...attempts.slice(1)] })).toThrow('invalid assignment id');
  });

  it('exports only deidentified feedback fields and preserves errors', () => {
    const safe = deidentifyStudyResult({ case_number: 4, status: 'error', assignment_id: 'private', student_id: 'private', error: { code: 'CONTEXT_UNRECOVERABLE' }, evaluation: { strengths: ['A'], communication_score: 2, clinical_reasoning_score: 3, communication_breakdown: { focused_information_gathering: { score: 1 }, closed_loop_team_communication: { score: 2 }, efficiency_deduction: { score: 0 } }, clinical_reasoning_breakdown: { orders_monitoring_quality: { score: 2 }, clinical_reasoning_documentation: { score: 1 }, safety_deduction: { score: -1 } } } });
    expect(safe).not.toHaveProperty('assignment_id');
    expect(safe).not.toHaveProperty('student_id');
    expect(safe.error).toEqual({ code: 'CONTEXT_UNRECOVERABLE' });
    expect(safe.component_scores).toEqual({ focused_information_gathering: 1, closed_loop_team_communication: 2, efficiency_deduction: 0, orders_monitoring_quality: 2, clinical_reasoning_documentation: 1, safety_deduction: -1 });
    expect(studySheetRow(safe).length).toBe(STUDY_SHEET_COLUMNS.length);
    expect(csvEscape('a,"b')).toBe('"a,""b"');
  });

  it('snapshots feedback/status/grade protection for both successful and error attempts', () => {
    const assignment = {
      feedback_status: 'completed', grade: 87, nurse_feedback: { old: true },
      feedback_error: null, communication_score: 4, mdm_score: 3,
      unrelated_private_field: 'must not be copied',
    };
    const snapshot = snapshotAssignmentProtection(assignment);
    expect(Object.keys(snapshot)).toEqual([...STUDY_ASSIGNMENT_PROTECTED_FIELDS]);
    expect(snapshot).toMatchObject({ feedback_status: 'completed', grade: 87, nurse_feedback: { old: true } });
    expect(snapshot).not.toHaveProperty('unrelated_private_field');
    const errorAttempt = snapshotAssignmentProtection({ ...assignment, feedback_status: 'failed', feedback_error: 'CONTEXT_UNRECOVERABLE', grade: null });
    expect(errorAttempt).toMatchObject({ feedback_status: 'failed', feedback_error: 'CONTEXT_UNRECOVERABLE', grade: null });
  });
});
