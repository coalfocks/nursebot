import { describe, expect, it } from 'vitest';
import { mergeEvaluationSections } from './feedback-operations';
import { canonicalizeEvaluation } from './evaluation-scoring';

const communication = {
  communication_breakdown: {
    focused_information_gathering: { score: 2, feedback: 'Focused.', evidence_event_ids: ['s-1'] },
    closed_loop_team_communication: { score: 2, feedback: 'Loop.', evidence_event_ids: ['s-1'] },
    efficiency_deduction: { score: 0, feedback: 'None observed.', evidence_event_ids: [] },
  },
};

describe('section failure isolation', () => {
  it('keeps valid communication scores when the MDM section is missing', () => {
    const result = canonicalizeEvaluation(mergeEvaluationSections(communication, {}) as any);
    expect(result.communication_score).toBe(4);
    expect(result.mdm_score).toBeNull();
    expect(result.mdm_breakdown.orders_monitoring_quality.not_scored_reason).toMatch(/missing/i);
    expect(result.safety_result.level).toBe('not_assessed');
  });

  it('keeps valid MDM scores when the communication section is missing', () => {
    const mdm = {
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: { score: 3, feedback: 'Appropriate.', evidence_event_ids: ['o-1'] },
        clinical_reasoning_documentation: { score: 2, feedback: 'Reasoned.', evidence_event_ids: ['n-1'] },
        safety_deduction: { score: 0, feedback: 'None.', evidence_event_ids: [] },
      },
      safety_result: { level: 'none', action: null, rationale: 'No unsafe action.', evidence_event_ids: [] },
    };
    const result = canonicalizeEvaluation(mergeEvaluationSections({}, mdm) as any);
    expect(result.mdm_score).toBe(5);
    expect(result.communication_score).toBeNull();
    expect(result.safety_result.level).toBe('none');
  });
});
