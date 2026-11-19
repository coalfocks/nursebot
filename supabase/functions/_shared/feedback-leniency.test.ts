import { describe, expect, it } from 'vitest';
import { applyLeniencyToEvaluation, borderlineFlagInstruction, normalizeLeniencyMultiplier, readRoomLeniencyMultiplier } from './feedback-leniency';
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

  it('applies a 1.2 room: softens deductions (including safety) and rounds positives, then recomputes totals', () => {
    const result = applyLeniencyToEvaluation(base(), 1.2);
    // Round-half-up at 1.2 leaves these small positives unchanged (1.2->1, 2.4->2).
    expect(result.communication_breakdown.focused_information_gathering.score).toBe(1);
    expect(result.communication_breakdown.closed_loop_team_communication.score).toBe(2);
    expect(result.mdm_breakdown.orders_monitoring_quality.score).toBe(2);
    expect(result.mdm_breakdown.clinical_reasoning_documentation.score).toBe(1);
    // Deductions are pulled toward zero: ceil(-1/1.2)=0, ceil(-2/1.2)=-1 (safety included).
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(0);
    expect(result.mdm_breakdown.safety_deduction.score).toBe(-1);
    expect(result.communication_score).toBe(3);
    expect(result.mdm_score).toBe(2);
  });

  it('keeps the safety level label while scaling its numeric deduction', () => {
    const result = applyLeniencyToEvaluation(base(), 1.5);
    expect(result.safety_result.level).toBe('critical');
    expect(result.mdm_breakdown.safety_deduction.score).toBe(-1);
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

describe('1.2 room score mapping across components and safety levels', () => {
  const component = (score: number | null) => ({ score, feedback: 'x', evidence_event_ids: [] as string[] });
  const evaluationWith = (positives: { gather: number; loop: number; orders: number; reasoning: number }, efficiency: number, safety: { level: 'none' | 'concern' | 'critical' | 'not_assessed'; score: number | null }) =>
    canonicalizeEvaluation({
      communication_breakdown: {
        focused_information_gathering: component(positives.gather),
        closed_loop_team_communication: component(positives.loop),
        efficiency_deduction: component(efficiency),
      },
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: component(positives.orders),
        clinical_reasoning_documentation: component(positives.reasoning),
        safety_deduction: component(safety.score),
      },
      safety_result: { level: safety.level, action: null, rationale: null, evidence_event_ids: [] },
    } as any);

  it.each([
    // [raw positive score, max, expected at 1.2, expected at 1.5]
    // Unflagged positives are never lifted by the room factor; only borderline_up adds +1.
    [0, 2, 0, 0],
    [1, 2, 1, 1],
    [2, 2, 2, 2],
    [0, 3, 0, 0],
    [1, 3, 1, 1],
    [2, 3, 2, 2],
    [3, 3, 3, 3],
  ])('positive score %i (max %i) stays %i at 1.2 and %i at 1.5 without a borderline flag', (raw, max, at12, at15) => {
    const input = evaluationWith(
      { gather: max === 2 ? raw : 0, loop: max === 3 ? raw : 0, orders: 0, reasoning: 0 },
      0,
      { level: 'none', score: 0 },
    );
    const at = (multiplier: number) => {
      const out = applyLeniencyToEvaluation(input, multiplier);
      return max === 2 ? out.communication_breakdown.focused_information_gathering.score : out.communication_breakdown.closed_loop_team_communication.score;
    };
    expect(at(1.2)).toBe(at12);
    expect(at(1.5)).toBe(at15);
  });

  it.each([
    // efficiency deduction raw -> at 1.2 (ceil toward zero)
    [0, 0],
    [-1, 0],
    [-2, -1],
  ])('efficiency deduction %i maps to %i at 1.2', (raw, expected) => {
    const out = applyLeniencyToEvaluation(evaluationWith({ gather: 1, loop: 1, orders: 1, reasoning: 1 }, raw, { level: 'none', score: 0 }), 1.2);
    expect(out.communication_breakdown.efficiency_deduction.score).toBe(expected);
  });

  it.each([
    // [safety level, raw safety deduction, expected deduction at 1.2, expected level]
    ['none', 0, 0, 'none'],
    ['concern', -1, 0, 'concern'],
    ['concern', -2, -1, 'concern'],
    ['critical', -2, -1, 'critical'],
    ['critical', -1, 0, 'critical'],
    ['not_assessed', null, null, 'not_assessed'],
  ] as const)('safety level %s with deduction %s maps to %s at 1.2 (level kept as %s)', (level, raw, expected, expectedLevel) => {
    const out = applyLeniencyToEvaluation(evaluationWith({ gather: 1, loop: 1, orders: 1, reasoning: 1 }, 0, { level, score: raw }), 1.2);
    expect(out.mdm_breakdown.safety_deduction.score).toBe(expected);
    expect(out.safety_result.level).toBe(expectedLevel);
  });

  it('pushes a -1 safety deduction to -2 in a strict 0.8 room (floor)', () => {
    const out = applyLeniencyToEvaluation(evaluationWith({ gather: 1, loop: 1, orders: 1, reasoning: 1 }, 0, { level: 'concern', score: -1 }), 0.8);
    expect(out.mdm_breakdown.safety_deduction.score).toBe(-2);
  });
});


describe('borderline lift for lenient rooms', () => {
  const comp = (score: number | null, borderline_up?: boolean) => ({
    score, feedback: 'x', evidence_event_ids: [] as string[], ...(borderline_up === undefined ? {} : { borderline_up }),
  });
  const build = (gather: ReturnType<typeof comp>, orders: ReturnType<typeof comp>, loop = comp(1), reasoning = comp(1)) => canonicalizeEvaluation({
    communication_breakdown: { focused_information_gathering: gather, closed_loop_team_communication: loop, efficiency_deduction: comp(0) },
    clinical_reasoning_breakdown: { orders_monitoring_quality: orders, clinical_reasoning_documentation: reasoning, safety_deduction: comp(0) },
    safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
  } as any);

  it('adds +1 only to flagged positive components below their max in a lenient room', () => {
    const result = applyLeniencyToEvaluation(build(comp(1, true), comp(2, true)), 1.2);
    expect(result.communication_breakdown.focused_information_gathering.score).toBe(2);
    expect(result.communication_breakdown.focused_information_gathering.leniency_bumped).toBe(true);
    expect(result.mdm_breakdown.orders_monitoring_quality.score).toBe(3);
    expect(result.communication_breakdown.closed_loop_team_communication.score).toBe(1);
    expect(result.mdm_breakdown.clinical_reasoning_documentation.score).toBe(1);
    expect(result.communication_breakdown.closed_loop_team_communication.leniency_bumped).toBeUndefined();
    expect(result.communication_score).toBe(3);
    expect(result.mdm_score).toBe(4);
  });

  it('never raises a component above its max, and ignores flags on null scores', () => {
    const result = applyLeniencyToEvaluation(build(comp(2, true), comp(null, true)), 1.2);
    expect(result.communication_breakdown.focused_information_gathering.score).toBe(2);
    expect(result.communication_breakdown.focused_information_gathering.leniency_bumped).toBeUndefined();
    expect(result.mdm_breakdown.orders_monitoring_quality.score).toBeNull();
    expect(result.mdm_score).toBeNull();
  });

  it('keeps the safety label and the existing deduction softening unchanged', () => {
    const result = applyLeniencyToEvaluation(build(comp(1, true), comp(2, false)), 1.2);
    expect(result.safety_result.level).toBe('none');
    expect(result.mdm_breakdown.safety_deduction.score).toBe(0);
  });

  it('ignores borderline flags in default rooms and keeps strict-room rounding', () => {
    const evaluation = build(comp(1, true), comp(2, true));
    expect(applyLeniencyToEvaluation(evaluation, 1)).toBe(evaluation);
    const strict = applyLeniencyToEvaluation(evaluation, 0.8);
    expect(strict.communication_breakdown.focused_information_gathering.score).toBe(1);
    expect(strict.mdm_breakdown.orders_monitoring_quality.score).toBe(2);
    expect(strict.communication_breakdown.focused_information_gathering.leniency_bumped).toBeUndefined();
  });

  it('adds the borderline instruction only for lenient rooms', () => {
    expect(borderlineFlagInstruction(1)).toBe('');
    expect(borderlineFlagInstruction(0.8)).toBe('');
    expect(borderlineFlagInstruction(undefined)).toBe('');
    expect(borderlineFlagInstruction(1.2)).toContain('"borderline_up": true');
  });
});
