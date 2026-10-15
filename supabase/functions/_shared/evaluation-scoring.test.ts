import { describe, expect, it } from 'vitest';
import { buildEvidenceBackedFallback, canonicalizeEvaluation, hasMeaningfulEvidence } from './evaluation-scoring';

describe('feedback v2 canonical contract', () => {
  it('preserves the two anchored composites and never subtracts safety', () => {
    const result = canonicalizeEvaluation({
      learning_objectives: 'text',
      communication_breakdown: {
        focused_information_gathering: { score: 2, feedback: 'focused' },
        closed_loop_team_communication: { score: 3, feedback: 'closed loop' },
      },
      mdm_breakdown: {
        orders_monitoring_quality: { score: 3, feedback: 'orders' },
        clinical_reasoning_documentation: { score: 2, feedback: 'reasoning' },
      },
      safety_result: { level: 'critical', action: 'unsafe order', rationale: 'contraindicated', evidence_event_ids: ['order-1'] },
      recommendations: [], strengths: [], improvements: [],
    });
    expect(result.communication_score).toBe(5);
    expect(result.mdm_score).toBe(5);
    expect(result.safety_result.level).toBe('critical');
    expect(result.safety_result.evidence_event_ids).toEqual(['order-1']);
  });

  it('clamps only anchored components and reports missing evidence instead of inventing zeros', () => {
    const result = canonicalizeEvaluation({
      communication_breakdown: {
        focused_information_gathering: { score: 9, feedback: '' },
        closed_loop_team_communication: { score: -2, feedback: '' },
      },
      mdm_breakdown: {
        orders_monitoring_quality: { score: 8, feedback: '' },
        clinical_reasoning_documentation: { score: -3, feedback: '' },
      },
      safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
    });
    expect(result.communication_score).toBe(2);
    expect(result.mdm_score).toBe(3);
    expect(result.communication_breakdown.closed_loop_team_communication.feedback).toContain('Insufficient evidence');
    expect(result.mdm_breakdown.clinical_reasoning_documentation.feedback).toContain('Insufficient evidence');
  });

  it('requires a non-empty source manifest before treating an attempt as evidence-bearing', () => {
    expect(hasMeaningfulEvidence(['message-1', 'order-1'])).toBe(true);
    expect(hasMeaningfulEvidence([])).toBe(false);
  });

  it('normalizes legacy evaluator breakdown keys into the canonical contract', () => {
    const result = canonicalizeEvaluation({
      communication_breakdown: {
        information_sharing: { score: 2, feedback: 'focused legacy evidence' },
        responsive_communication: { score: 2, feedback: 'closed-loop legacy evidence' },
      },
      mdm_breakdown: {
        labs_orders_quality: { score: 3, feedback: 'orders legacy evidence' },
        note_thought_process: { score: 2, feedback: 'reasoning legacy evidence' },
      },
      safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
    });
    expect(result.communication_score).toBe(4);
    expect(result.mdm_score).toBe(5);
    expect(result.communication_breakdown.focused_information_gathering.feedback).toBe('focused legacy evidence');
    expect(result.mdm_breakdown.clinical_reasoning_documentation.feedback).toBe('reasoning legacy evidence');
  });

  it('accepts numeric-string and value-shaped evaluator component scores', () => {
    const result = canonicalizeEvaluation({
      communication: {
        information_gathering: { value: '2', feedback: 'bedside history' },
        closed_loop_communication: { points: '3', feedback: 'escalation and reassessment' },
      },
      medical_decision_making: {
        orders_monitoring: { score: '3', feedback: 'urgent monitoring' },
        reasoning_documentation: { value: 2, feedback: 'documented rationale' },
      },
    });
    expect(result.communication_score).toBe(5);
    expect(result.mdm_score).toBe(5);
  });

  it('recovers a conservative anchored score from learner actions when the evaluator returns all zero', () => {
    const result = buildEvidenceBackedFallback(canonicalizeEvaluation({}), [
      { kind: 'message', title: 'Nurse message', body: 'unstable' },
      { kind: 'message', title: 'Student message', body: 'I am at bedside and escalating.' },
      { kind: 'vital', title: 'Vital reassessment' },
      { kind: 'order', title: 'Order: monitoring' },
    ], 'Focused reassessment and escalation documented.')
    expect(result?.communication_score).toBe(2);
    expect(result?.mdm_score).toBe(2);
    expect(buildEvidenceBackedFallback(canonicalizeEvaluation({}), [{ kind: 'message', title: 'Nurse message' }], null)).toBeNull();
  });
});
