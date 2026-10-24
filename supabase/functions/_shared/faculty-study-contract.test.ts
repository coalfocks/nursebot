import { describe, expect, it } from 'vitest';
import { buildEvaluationSheetHtml, buildStudyFeedbackBackup, csvEscape, deidentifyStudyResult, isStudyRunLeaseExpired, isTerminalStudyResult, protectedAssignmentUnchanged, redactStudyValue, snapshotAssignmentProtection, studyActionAllowed, STUDY_ASSIGNMENT_PROTECTED_FIELDS, STUDY_SHEET_COLUMNS, studyResultStatus, studySheetRow, validateStudyManifest } from './faculty-study-contract';

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

  it('keeps one flattened reviewer shape across JSON, sheet, and document exports', () => {
    const canonical = {
      strengths: ['Jane identified the sepsis concern and escalated to the team.'],
      improvements: ['Jane should close the loop on the pending lactate result.'],
      recommendations: ['Use the documented trend to reassess the patient.'],
      communication_score: 4,
      clinical_reasoning_score: 5,
      communication_breakdown: {
        focused_information_gathering: { score: 2, narrative: 'Full focused narrative.' },
        closed_loop_team_communication: { score: 1, narrative: 'Full closed-loop narrative.' },
        efficiency_deduction: { score: 0, narrative: 'No deduction.' },
      },
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: { score: 2, narrative: 'Full orders narrative.' },
        clinical_reasoning_documentation: { score: 1, narrative: 'Full reasoning narrative.' },
        safety_deduction: { score: 0, narrative: 'No deduction.' },
      },
    };
    const reviewer = deidentifyStudyResult({
      batch_ordinal: 4,
      specialty: 'ED',
      case_label: 'Case 4',
      packet_label: 'Packet 2',
      status: 'completed',
      evaluation: canonical,
      evidence_event_ids: ['event-4'],
      generated_at: '2026-10-24T00:00:00.000Z',
      prompt_version: 'rubric-v4',
      model: 'study-model',
      redaction_terms: ['Jane'],
    }) as Record<string, unknown>;
    const sheet = studySheetRow(reviewer);
    const document = JSON.parse(JSON.stringify(reviewer)) as Record<string, unknown>;

    expect(reviewer.communication_score).toBe(4);
    expect(reviewer.clinical_reasoning_score).toBe(5);
    expect(reviewer.component_scores).toEqual({
      focused_information_gathering: 2,
      closed_loop_team_communication: 1,
      efficiency_deduction: 0,
      orders_monitoring_quality: 2,
      clinical_reasoning_documentation: 1,
      safety_deduction: 0,
    });
    expect(reviewer.strengths).toEqual(['[redacted-name] identified the sepsis concern and escalated to the team.']);
    expect(JSON.parse(String(sheet[7]))).toEqual(document.strengths);
    expect(JSON.parse(String(sheet[8]))).toEqual(document.improvements);
    expect(JSON.parse(String(sheet[9]))).toEqual(document.recommendations);
    expect(JSON.parse(String(sheet[10]))).toEqual(document.evidence_event_ids);
    expect(JSON.parse(String(sheet[15]))).toBe(2);
    expect(JSON.parse(String(sheet[20]))).toBe(0);
    expect(document.communication_breakdown).toEqual(reviewer.communication_breakdown);
    expect(document.clinical_reasoning_breakdown).toEqual(reviewer.clinical_reasoning_breakdown);
    expect(JSON.parse(String(sheet[21]))).toEqual(document.communication_breakdown);
    expect(JSON.parse(String(sheet[22]))).toEqual(document.clinical_reasoning_breakdown);
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

  it('builds a private all-attempt feedback backup with explicit missing rows', () => {
    const found = buildStudyFeedbackBackup(attempts[0], { id: attempts[0].assignment_id, status: 'completed', grade: 4, nurse_feedback: 'existing' });
    expect(found).toMatchObject({ batch_ordinal: 1, assignment_id: attempts[0].assignment_id, found: true, raw_feedback_backup: { grade: 4, nurse_feedback: 'existing' } });
    expect(buildStudyFeedbackBackup(attempts[1], null)).toMatchObject({ batch_ordinal: 2, found: false, raw_feedback_backup: null });
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

  it('recognizes expired and active run leases for stale-run recovery controls', () => {
    const now = Date.parse('2026-10-24T00:00:00.000Z');
    expect(isStudyRunLeaseExpired('2026-10-23T23:59:59.999Z', now)).toBe(true);
    expect(isStudyRunLeaseExpired('2026-10-24T00:00:00.001Z', now)).toBe(false);
    expect(isStudyRunLeaseExpired(null, now)).toBe(false);
  });

  it('server-denies prepare and run in preflight-only deployment mode', () => {
    expect(studyActionAllowed('preflight', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('audit', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('history', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('export', 'preflight-only')).toBe(true);
    expect(studyActionAllowed('prepare', 'preflight-only')).toBe(false);
    expect(studyActionAllowed('run', 'preflight-only')).toBe(false);
    expect(STUDY_ASSIGNMENT_PROTECTED_FIELDS).not.toContain('evaluator_config_id');
    expect(STUDY_ASSIGNMENT_PROTECTED_FIELDS).not.toContain('evaluator_version');
    expect(studyActionAllowed('prepare', 'study-enabled')).toBe(true);
  });

  it('does not treat missing or unknown deployment configuration as study-enabled', () => {
    expect(studyActionAllowed('prepare', 'preflight-only')).toBe(false);
    expect(studyActionAllowed('run', 'preflight-only')).toBe(false);
  });

  it('renders a printable new-format sheet with all six components and both domains', () => {
    const html = buildEvaluationSheetHtml({
      batch_ordinal: 1, specialty: 'ED', case_label: 'Case 1', packet_label: 'Packet 1', status: 'completed', prompt_version: 'new-format-v1', generated_at: '2026-10-24T00:00:00Z', model: 'gpt-6-luna',
      component_scores: { focused_information_gathering: 2, closed_loop_team_communication: 3, efficiency_deduction: 0, orders_monitoring_quality: 3, clinical_reasoning_documentation: 2, safety_deduction: 0 },
      domain_scores: { communication: 5, clinical_reasoning: 5 }, strengths: ['clear'], improvements: ['reassess'], recommendations: ['continue'], communication_breakdown: { focused_information_gathering: { feedback: 'clear' } }, clinical_reasoning_breakdown: { orders_monitoring_quality: { feedback: 'clear' } }, evidence_event_ids: ['event-1'],
    });
    expect(html).toContain('Focused information gathering');
    expect(html).toContain('Safety deduction');
    expect(html).toContain('Communication domain');
    expect(html).toContain('Clinical reasoning domain');
    expect(html).toContain('new-format-v1');
  });
});
