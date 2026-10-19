import { describe, expect, it } from 'vitest';
import { buildEvidenceBackedFallback, canonicalizeEvaluation, hasMeaningfulEvidence, hasValidSixComponentEvaluation, sanitizeSimulationText } from './evaluation-scoring';

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

  it('accepts legitimate zero components but rejects malformed numeric and safety values', () => {
    const component = (score: unknown) => ({ score, feedback: 'not observed', evidence_event_ids: [] });
    const valid = {
      communication_breakdown: { focused_information_gathering: component(0), closed_loop_team_communication: component('0'), efficiency_deduction: component(0) },
      clinical_reasoning_breakdown: { orders_monitoring_quality: component(0), clinical_reasoning_documentation: component(0), safety_deduction: component(0) },
      safety_result: { level: 'none', evidence_event_ids: [] },
    };
    expect(hasValidSixComponentEvaluation(valid)).toBe(true);
    expect(hasValidSixComponentEvaluation({ ...valid, communication_breakdown: { ...valid.communication_breakdown, focused_information_gathering: component(true) } })).toBe(false);
    expect(hasValidSixComponentEvaluation({ ...valid, clinical_reasoning_breakdown: { ...valid.clinical_reasoning_breakdown, safety_deduction: component(-1.5) } })).toBe(false);
    expect(hasValidSixComponentEvaluation({ ...valid, safety_result: { level: 'none', evidence_event_ids: ['event-1'] }, clinical_reasoning_breakdown: { ...valid.clinical_reasoning_breakdown, safety_deduction: component('') } })).toBe(false);
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

  it('does not treat vitals or a generic progress note as Communication evidence', () => {
    const result = buildEvidenceBackedFallback(canonicalizeEvaluation({}), [
      { kind: 'message', title: 'Nurse message', body: 'Nurse page only; not learner evidence.' },
      { kind: 'vital', title: 'Vitals updated', body: 'HR 128' },
      { kind: 'order', title: 'Order: telemetry', body: 'STAT' },
      { kind: 'progress-note', title: 'Student progress note', body: 'Reassessed unstable patient and escalated.' },
    ], 'Reassessed unstable patient and escalated.');

    expect(result).not.toBeNull();
    expect(result?.communication_score).toBe(0);
    expect(result?.mdm_score).toBeGreaterThan(0);
    expect(result?.communication_breakdown.closed_loop_team_communication.score).toBe(0);
    expect(result?.communication_breakdown.focused_information_gathering.feedback).toContain('vitals');
  });

  it('credits a structured learner bedside finding and team escalation without nurse chat', () => {
    const result = buildEvidenceBackedFallback(canonicalizeEvaluation({}), [
      { kind: 'message', title: 'Nurse message', body: 'Nurse page only; not learner evidence.' },
      { kind: 'vital', title: 'Vitals updated', body: 'HR 128' },
      { kind: 'learner-action', title: 'Learner bedside finding', body: 'At bedside: cool extremities and delayed capillary refill.', meta: ['Channel: bedside', 'Author: Student'] },
      { kind: 'learner-action', title: 'Learner team escalation', body: 'Escalated concern to senior clinician and requested immediate review.', meta: ['Channel: team', 'Author: Student'] },
      { kind: 'order', title: 'Order: telemetry', body: 'STAT' },
    ], 'Bedside findings and escalation documented.');

    expect(result?.communication_score).toBe(2);
    expect(result?.communication_breakdown.closed_loop_team_communication.score).toBe(1);
  });

  it('does not claim that a computer simulation included a physical exam', () => {
    expect(sanitizeSimulationText('Documented specific bedside signs after a physical exam.'))
      .toBe('Recorded learner-reported simulated bedside findings after a simulated bedside interaction.');
    const result = canonicalizeEvaluation({
      strengths: ['The learner examined the patient and escalated.'],
      communication_breakdown: { focused_information_gathering: { score: 1, feedback: 'physical exam observed' } },
    });
    expect(result.strengths[0]).toContain('assessed the patient in the simulation');
    expect(result.communication_breakdown.focused_information_gathering.feedback).toContain('simulated bedside interaction');
  });

  it('applies the confirmed three-part deductions only when supplied by case-specific evidence', () => {
    const result = canonicalizeEvaluation({
      communication_breakdown: {
        focused_information_gathering: { score: 2, feedback: 'focused' },
        closed_loop_team_communication: { score: 3, feedback: 'closed loop' },
        efficiency_deduction: { score: -1, feedback: 'Observed case-specific unnecessary delay.' },
      },
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: { score: 3, feedback: 'orders' },
        clinical_reasoning_documentation: { score: 2, feedback: 'reasoning' },
        safety_deduction: { score: -2, feedback: 'One actual unsafe order.' },
      },
      safety_result: { level: 'critical', action: 'unsafe order', rationale: 'specific action', evidence_event_ids: ['order-1'] },
    });
    expect(result.communication_score).toBe(4);
    expect(result.clinical_reasoning_score).toBe(3);
    expect(result.mdm_score).toBe(3);
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(-1);
    expect(result.clinical_reasoning_breakdown.safety_deduction.score).toBe(-2);
  });

  it('bounds displayed strengths and improvements to three authored items', () => {
    const result = canonicalizeEvaluation({
      strengths: ['one', 'two', 'three', 'four'],
      improvements: ['one', 'two', 'three', 'four'],
    });
    expect(result.strengths).toHaveLength(3);
    expect(result.improvements).toHaveLength(3);
  });

  it('does not impose an efficiency deduction for bedside-first care or missing nurse chat', () => {
    const result = canonicalizeEvaluation({
      communication_breakdown: {
        focused_information_gathering: { score: 1, feedback: 'bedside finding' },
        closed_loop_team_communication: { score: 1, feedback: 'team escalation' },
      },
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: { score: 1, feedback: 'monitoring' },
        clinical_reasoning_documentation: { score: 1, feedback: 'note' },
      },
    });
    expect(result.communication_score).toBe(2);
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(0);
  });
});
