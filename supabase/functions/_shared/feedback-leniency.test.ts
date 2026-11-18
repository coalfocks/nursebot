import { describe, expect, it } from 'vitest';
import { applyLeniencyToEvaluation, normalizeLeniencyMultiplier, readRoomLeniencyMultiplier } from './feedback-leniency';
import { canonicalizeEvaluation } from './evaluation-scoring';

const base = (overrides: Record<string, any> = {}) => canonicalizeEvaluation({
  communication_breakdown: {
    focused_information_gathering: { score: 1, feedback: 'Some gathering.', evidence_event_ids: ['s-1'] },
    closed_loop_team_communication: { score: 2, feedback: 'Loop initiated.', evidence_event_ids: ['s-2'] },
    efficiency_deduction: { score: -1, feedback: 'Minor interference.', evidence_event_ids: ['s-3'] },
  },
  clinical_reasoning_breakdown: {
    orders_monitoring_quality: { score: 2, feedback: 'Main direction.', evidence_event_ids: ['o-1'] },
    clinical_reasoning_documentation: { score: 1, feedback: 'Partial reasoning.', evidence_event_ids: ['n-1'] },
    safety_deduction: { score: -2, feedback: 'Critical action.', evidence_event_ids: ['o-2'] },
  },
  safety_result: { level: 'critical', action: 'Ordered X', rationale: 'Severe risk.', evidence_event_ids: ['o-2'] },
  ...overrides,
} as any);

describe('room leniency modifier on the scoring path', () => {
  it('leaves scores untouched at the default multiplier of 1', () => {
    const evaluation = base();
    expect(applyLeniencyToEvaluation(evaluation, 1)).toBe(evaluation);
    expect(applyLeniencyToEvaluation(evaluation, undefined)).toBe(evaluation);
  });

  it('applies a 1.2 room: softens deductions and rounds positives, then recomputes totals', () => {
    const result = applyLeniencyToEvaluation(base(), 1.2);
    // Positive integers round back under 1.2 (1*1.2=1.2, 2*1.2=2.4, 1*1.2=1.2).
    expect(result.communication_breakdown.focused_information_gathering.score).toBe(1);
    expect(result.communication_breakdown.closed_loop_team_communication.score).toBe(2);
    expect(result.mdm_breakdown.orders_monitoring_quality.score).toBe(2);
    expect(result.mdm_breakdown.clinical_reasoning_documentation.score).toBe(1);
    // Deductions are pulled toward zero: ceil(-1/1.2)=0, ceil(-2/1.2)=-1.
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(0);
    expect(result.communication_score).toBe(3);
    expect(result.mdm_score).toBe(1);
  });

  it('does not rescale the safety deduction or safety label, which are reported separately', () => {
    const result = applyLeniencyToEvaluation(base(), 1.5);
    expect(result.safety_result.level).toBe('critical');
    expect(result.mdm_breakdown.safety_deduction.score).toBe(-2);
    expect(result.clinical_reasoning_score).toBe(result.mdm_score);
  });

  it('scales a strict 0.8 room in the other direction', () => {
    const result = applyLeniencyToEvaluation(base(), 0.8);
    // floor(-1/0.8) = -2 for the efficiency deduction; 1*0.8 rounds to 1.
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(-2);
    expect(result.communication_breakdown.focused_information_gathering.score).toBe(1);
  });

  it('keeps unassessable components null and their totals null', () => {
    const evaluation = base({
      communication_breakdown: {
        focused_information_gathering: { score: null, feedback: 'Not scored.', evidence_event_ids: [], not_scored_reason: 'Nurse channel unavailable.' },
        closed_loop_team_communication: { score: 3, feedback: 'Loop complete.', evidence_event_ids: ['s-2'] },
        efficiency_deduction: { score: 0, feedback: 'None.', evidence_event_ids: [] },
      },
    });
    const result = applyLeniencyToEvaluation(evaluation, 1.5);
    expect(result.communication_breakdown.focused_information_gathering.score).toBeNull();
    expect(result.communication_breakdown.focused_information_gathering.not_scored_reason).toBe('Nurse channel unavailable.');
    expect(result.communication_score).toBeNull();
    expect(result.communication_breakdown.closed_loop_team_communication.score).toBe(3);
  });

  it('clamps totals to the 0-5 band', () => {
    const result = applyLeniencyToEvaluation(base({
      communication_breakdown: {
        focused_information_gathering: { score: 2, feedback: 'x', evidence_event_ids: [] },
        closed_loop_team_communication: { score: 3, feedback: 'x', evidence_event_ids: [] },
        efficiency_deduction: { score: 0, feedback: 'x', evidence_event_ids: [] },
      },
    }), 1.5);
    expect(result.communication_score).toBe(5);
  });
});

describe('reading the room multiplier', () => {
  it('normalizes into the supported 0.75-1.5 band', () => {
    expect(normalizeLeniencyMultiplier(undefined)).toBe(1);
    expect(normalizeLeniencyMultiplier(Number.NaN)).toBe(1);
    expect(normalizeLeniencyMultiplier(10)).toBe(1.5);
    expect(normalizeLeniencyMultiplier(0.2)).toBe(0.75);
    expect(normalizeLeniencyMultiplier('1.2')).toBe(1.2);
  });

  it('reads evaluation.leniencyMultiplier from a JSON string or object emr_context', () => {
    expect(readRoomLeniencyMultiplier({ emr_context: JSON.stringify({ evaluation: { leniencyMultiplier: 1.2 } }) })).toBe(1.2);
    expect(readRoomLeniencyMultiplier({ emr_context: { evaluation: { leniencyMultiplier: 0.9 } } })).toBe(0.9);
    expect(readRoomLeniencyMultiplier({ emr_context: JSON.stringify({ context: 'no evaluation key' }) })).toBe(1);
    expect(readRoomLeniencyMultiplier({ emr_context: 'not json' })).toBe(1);
    expect(readRoomLeniencyMultiplier({})).toBe(1);
  });
});
