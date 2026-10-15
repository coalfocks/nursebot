import { describe, expect, it } from 'vitest';
import { canonicalizeEvaluation } from './evaluation-scoring';

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
});
