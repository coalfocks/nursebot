import { describe, expect, it } from 'vitest';
import { assignmentUpdateFromVersion, checkPromotable, PROMOTION_FIELDS, PROMOTE_CONFIRMATION, snapshotOfficialResult } from './feedback-rerun';

const comp = (score: number) => ({ score, feedback: 'f', evidence_event_ids: [], not_scored_reason: null });
const evaluation = {
  communication_score: 4, clinical_reasoning_score: 3, mdm_score: 3, learning_objectives: 'obj', improvements: [], recommendations: [],
  communication_breakdown: { focused_information_gathering: comp(2), closed_loop_team_communication: comp(2), efficiency_deduction: comp(0) },
  clinical_reasoning_breakdown: { orders_monitoring_quality: comp(2), clinical_reasoning_documentation: comp(1), safety_deduction: comp(0) },
  mdm_breakdown: { orders_monitoring_quality: comp(2), clinical_reasoning_documentation: comp(1), safety_deduction: comp(0) },
  safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
};
const version = { id: 'v1', assignment_id: 'a1', status: 'completed', technical_incomplete: false, promoted_at: null, result: { evaluation, debrief: { strengths: [] }, scoring_start_at: '2026-11-20T00:00:00Z', source_event_ids: ['e1'], case_key_version: 'case-key-v2' } };

describe('promote rerun', () => {
  it('requires the typed confirmation, a completed unpromoted version of the same assignment', () => {
    expect(checkPromotable(version, 'a1', undefined)).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' });
    expect(checkPromotable(version, 'a1', 'promote')).toMatchObject({ ok: false, code: 'CONFIRMATION_REQUIRED' });
    expect(checkPromotable(version, 'other', PROMOTE_CONFIRMATION)).toMatchObject({ ok: false, code: 'VERSION_NOT_FOUND' });
    expect(checkPromotable({ ...version, status: 'running' }, 'a1', PROMOTE_CONFIRMATION)).toMatchObject({ ok: false, code: 'NOT_COMPLETED' });
    expect(checkPromotable({ ...version, promoted_at: 'x' }, 'a1', PROMOTE_CONFIRMATION)).toMatchObject({ ok: false, code: 'ALREADY_PROMOTED' });
    expect(checkPromotable(null, 'a1', PROMOTE_CONFIRMATION)).toMatchObject({ ok: false, code: 'VERSION_NOT_FOUND' });
    expect(checkPromotable(version, 'a1', PROMOTE_CONFIRMATION)).toEqual({ ok: true });
  });
  it('builds the same assignment update a normal graded run writes, tagged with the source version', () => {
    const update = assignmentUpdateFromVersion(version) as Record<string, any>;
    expect(update).toMatchObject({ feedback_status: 'completed', communication_score: 4, mdm_score: 3, scoring_start_at: '2026-11-20T00:00:00Z', source_event_ids: ['e1'], technical_incomplete: false });
    expect(update.feedback_debrief.promoted_from_rerun_version_id).toBe('v1');
    expect(Object.keys(update)).toEqual(expect.arrayContaining(['safety_result', 'nurse_feedback', 'rubric_version']));
  });
  it('snapshots every replaced field so a promotion can be restored', () => {
    const snap = snapshotOfficialResult({ communication_score: 1, feedback_debrief: { a: 1 } });
    expect(Object.keys(snap).sort()).toEqual([...PROMOTION_FIELDS].sort());
    expect(snap.communication_score).toBe(1);
    expect(snap.mdm_score).toBeNull();
  });
});
