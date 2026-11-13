import { describe, expect, it } from 'vitest';
import { EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { filterTimelineToScoringWindow, renderTimelineEntriesForEvaluation, type EvaluationTimelineEntry } from './assignment-timeline';
import { canonicalizeEvaluation, isLearnerAuthoredEvidence } from './evaluation-scoring';

const complete = (overrides: Record<string, unknown> = {}) => ({
  communication_breakdown: {
    focused_information_gathering: { score: 2, feedback: 'Focused learner assessment.', evidence_event_ids: ['student-1'] },
    closed_loop_team_communication: { score: 3, feedback: 'Clear request and response loop.', evidence_event_ids: ['consult-request'] },
    efficiency_deduction: { score: 0, feedback: 'No observed interference.', evidence_event_ids: [] },
  },
  clinical_reasoning_breakdown: {
    orders_monitoring_quality: { score: 3, feedback: 'Appropriate monitoring.', evidence_event_ids: ['order-1'] },
    clinical_reasoning_documentation: { score: 2, feedback: 'Reasoning linked to findings.', evidence_event_ids: ['note-1'] },
    safety_deduction: { score: 0, feedback: 'Safety reviewed; no unsafe learner action observed.', evidence_event_ids: [] },
  },
  safety_result: { level: 'none', action: null, rationale: 'No unsafe learner action observed.', evidence_event_ids: [] },
  ...overrides,
});

describe('evidence-based evaluation contract', () => {
  it('calibrates a stable no-consult case to full scores when all anchors are met', () => {
    const result = canonicalizeEvaluation(complete() as any);
    expect(result.communication_score).toBe(5);
    expect(result.mdm_score).toBe(5);
  });

  it('preserves a genuine observed zero instead of replacing it with heuristic credit', () => {
    const input = complete({
      communication_breakdown: {
        focused_information_gathering: { score: 0, feedback: 'No focused learner information gathering was observed.', evidence_event_ids: ['student-1'] },
        closed_loop_team_communication: { score: 0, feedback: 'No responsive loop was observed.', evidence_event_ids: ['student-1'] },
        efficiency_deduction: { score: 0, feedback: 'No observed interference.', evidence_event_ids: [] },
      },
    });
    expect(canonicalizeEvaluation(input as any).communication_score).toBe(0);
  });

  it('marks missing components unassessable with a reason and nulls dependent totals', () => {
    const input = complete({ clinical_reasoning_breakdown: { orders_monitoring_quality: { score: 1, feedback: 'One order observed.' } } });
    const result = canonicalizeEvaluation(input as any);
    expect(result.communication_score).toBe(5);
    expect(result.mdm_score).toBeNull();
    expect(result.mdm_breakdown.clinical_reasoning_documentation.score).toBeNull();
    expect(result.mdm_breakdown.clinical_reasoning_documentation.not_scored_reason).toMatch(/missing/i);
    expect(result.mdm_breakdown.safety_deduction.score).toBeNull();
    expect(result.safety_result.level).toBe('not_assessed');
  });

  it('does not coerce invalid deductions to -2 or another boundary', () => {
    const input = complete({
      communication_breakdown: { ...complete().communication_breakdown, efficiency_deduction: { score: -3, feedback: 'Invalid deduction.' } },
      clinical_reasoning_breakdown: { ...complete().clinical_reasoning_breakdown, safety_deduction: { score: 1, feedback: 'Invalid deduction.' } },
    });
    const result = canonicalizeEvaluation(input as any);
    expect(result.communication_breakdown.efficiency_deduction.score).toBeNull();
    expect(result.communication_score).toBeNull();
    expect(result.mdm_breakdown.safety_deduction.score).toBeNull();
    expect(result.mdm_score).toBeNull();
  });

  it('requires a safety review result before treating safety as none or applying a deduction', () => {
    const { safety_result: _ignored, ...input } = complete();
    const result = canonicalizeEvaluation(input as any);
    expect(result.safety_result.level).toBe('not_assessed');
    expect(result.mdm_breakdown.safety_deduction.score).toBeNull();
    expect(result.mdm_score).toBeNull();
  });

  it('uses structured actor fields and includes consultant requests but excludes consultant replies as learner evidence', () => {
    const request = { id: 'consult-request', actor_role: 'student', channel: 'consultant_chat', meta: ['Author: Consultant'] };
    const reply = { id: 'consult-reply', actor_role: 'consultant', channel: 'consultant_chat', meta: ['Author: Student'] };
    expect(isLearnerAuthoredEvidence(request)).toBe(true);
    expect(isLearnerAuthoredEvidence(reply)).toBe(false);
    expect(EVALUATION_SYSTEM_PROMPT).toContain("student's consultant request is learner evidence");
    expect(EVALUATION_SYSTEM_PROMPT).toContain('never infer authorship or channel by parsing a meta string');
  });

  it('allows bedside-first care without a communication penalty for missing nurse chat', () => {
    const result = canonicalizeEvaluation(complete({
      communication_breakdown: {
        focused_information_gathering: { score: 2, feedback: 'Learner documented bedside findings.', evidence_event_ids: ['bedside-1'] },
        closed_loop_team_communication: { score: 3, feedback: 'Learner escalated through the team channel.', evidence_event_ids: ['team-1'] },
        efficiency_deduction: { score: 0, feedback: 'No case-specific interference observed.', evidence_event_ids: [] },
      },
    }) as any);
    expect(result.communication_score).toBe(5);
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(0);
  });

  it('preserves timestamp order and surfaces tied or missing-time uncertainty', () => {
    const entries: EvaluationTimelineEntry[] = [
      { id: 'before', kind: 'message', timestamp: '2026-11-13T12:00:00Z', sequence: 1, actor_role: 'student', title: 'Student message' },
      { id: 'page', kind: 'message', timestamp: '2026-11-13T12:00:00Z', sequence: 2, actor_role: 'nurse', title: 'Nurse page' },
      { id: 'after', kind: 'consultant-message', timestamp: '2026-11-13T12:00:00Z', sequence: 3, actor_role: 'student', title: 'Consult request' },
      { id: 'tie-unknown', kind: 'order', timestamp: '2026-11-13T12:00:00Z', sequence: null, actor_role: 'student', title: 'Order' },
      { id: 'missing-time', kind: 'message', timestamp: null, actor_role: 'student', title: 'Student message', body: 'Exact excerpt retained.' },
    ];
    const result = filterTimelineToScoringWindow(entries, '2026-11-13T12:00:00Z', 'page', 2);
    expect(result.scored.map((entry) => entry.id)).toEqual(['page', 'after']);
    expect(result.uncertain.map((entry) => entry.id)).toEqual(['tie-unknown']);
    expect(renderTimelineEntriesForEvaluation([entries[4]])).toContain('TIMESTAMP MISSING');
    expect(entries[4].body).toBe('Exact excerpt retained.');
  });
});
