import { describe, expect, it } from 'vitest';
import { csvEscape, deidentifyStudyResult, isTerminalStudyResult, protectedAssignmentUnchanged, redactStudyValue, snapshotAssignmentProtection, STUDY_ASSIGNMENT_PROTECTED_FIELDS, STUDY_SHEET_COLUMNS, studyResultStatus, studySheetRow, validateStudyManifest } from './faculty-study-contract';

const attempts = Array.from({ length: 30 }, (_, index) => ({ batch_ordinal: index + 1, specialty: ['ED', 'ICU', 'Peds', 'OB', 'Med-Surg', 'Psych'][index % 6], case_label: `Case ${index % 5 + 1}`, packet_label: `Packet ${index % 5 + 1}`, assignment_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
const manifest = { batch_key: 'faculty-oct-2026', prompt_version: 'revised-v4', prompt_text: 'Evaluate only the frozen historical attempt.', expected_model: 'gpt-6-luna', attempts };

describe('faculty study contract', () => {
  it('requires the fixed ordered 30-case manifest', () => {
    expect(validateStudyManifest(manifest).attempts).toHaveLength(30);
    expect(() => validateStudyManifest({ ...manifest, attempts: attempts.slice(1) })).toThrow('exactly 30');
    expect(() => validateStudyManifest({ ...manifest, attempts: [...attempts].reverse() })).toThrow('batch_ordinal');
    expect(validateStudyManifest({ ...manifest, attempts: attempts.map((item) => ({ ...item, case_label: 'Case 1' })) }).attempts[5].case_label).toBe('Case 1');
  });

  it('rejects duplicate assignments and malformed ids', () => {
    expect(() => validateStudyManifest({ ...manifest, attempts: attempts.map((item, i) => i === 1 ? { ...item, assignment_id: attempts[0].assignment_id } : item) })).toThrow('unique');
    expect(() => validateStudyManifest({ ...manifest, attempts: [{ ...attempts[0], assignment_id: 'not-an-id' }, ...attempts.slice(1)] })).toThrow('invalid assignment id');
  });

  it('exports only deidentified feedback fields and preserves errors', () => {
    const safe = deidentifyStudyResult({ batch_ordinal: 4, specialty: 'ED', case_label: 'Case 4', packet_label: 'Packet 4', status: 'error', assignment_id: 'private', student_id: 'private', error: { code: 'CONTEXT_UNRECOVERABLE' }, evaluation: { strengths: ['A'], communication_score: 2, clinical_reasoning_score: 3, communication_breakdown: { focused_information_gathering: { score: 1 }, closed_loop_team_communication: { score: 2 }, efficiency_deduction: { score: 0 } }, clinical_reasoning_breakdown: { orders_monitoring_quality: { score: 2 }, clinical_reasoning_documentation: { score: 1 }, safety_deduction: { score: -1 } } } });
    expect(safe).not.toHaveProperty('assignment_id');
    expect(safe).not.toHaveProperty('student_id');
    expect(safe.error).toEqual({ code: 'CONTEXT_UNRECOVERABLE' });
    expect(safe.component_scores).toEqual({ focused_information_gathering: 1, closed_loop_team_communication: 2, efficiency_deduction: 0, orders_monitoring_quality: 2, clinical_reasoning_documentation: 1, safety_deduction: -1 });
    expect(studySheetRow(safe).length).toBe(STUDY_SHEET_COLUMNS.length);
    expect(csvEscape('a,"b')).toBe('"a,""b"');
    expect(redactStudyValue('Contact jane@example.com for Jane Doe; evidence id 00000000-0000-4000-8000-000000000001', ['Jane Doe'])).toBe('Contact [redacted-email] for [redacted-name]; evidence id [redacted-id]');
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
    expect(protectedAssignmentUnchanged({ status: 'completed', ...assignment }, { status: 'completed', ...assignment })).toBe(true);
    expect(protectedAssignmentUnchanged({ status: 'completed', ...assignment }, { status: 'completed', ...assignment, grade: 88 })).toBe(false);
    expect(protectedAssignmentUnchanged({ status: 'completed', ...assignment }, { status: 'failed', ...assignment })).toBe(false);
  });

  it('does not treat a pre-created empty row as terminal and keeps label columns in the sheet', () => {
    const empty = { result: null, error: null };
    expect(isTerminalStudyResult(empty)).toBe(false);
    expect(studyResultStatus(empty)).toBe('pending');
    expect(studyResultStatus({ result: null, error: { code: 'CONTEXT_UNRECOVERABLE' } })).toBe('error');
    expect(studyResultStatus({ result: { status: 'completed' }, error: null })).toBe('completed');
    expect(STUDY_SHEET_COLUMNS.slice(0, 4)).toEqual(['batch_ordinal', 'specialty', 'case_label', 'packet_label']);
    expect(studySheetRow({ batch_ordinal: 1, specialty: 'OB', case_label: 'Case 3', packet_label: 'Packet 2', status: 'pending' }).slice(0, 4)).toEqual([1, 'OB', 'Case 3', 'Packet 2']);
  });
});
