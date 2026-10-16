import { describe, expect, it } from 'vitest';
import { feedbackDomainArithmetic, parseCanonicalFeedback } from './feedbackContract';

const component = (score: number, min: number, max: number) => ({ score, min, max, feedback: 'Observed in this attempt.', evidence_event_ids: ['event-1'] });

const fixture = {
  schema_version: 'feedback-contract-v1',
  room_label: 'Synthetic Room',
  target_diagnosis: 'Synthetic diagnosis',
  goals: ['Name the diagnosis.', 'Prioritize monitoring and orders.'],
  communication: { total: 3, components: {
    focused_information_gathering: component(1, 0, 2),
    closed_loop_team_communication: component(2, 0, 3),
    efficiency_deduction: component(0, -2, 0),
  }},
  clinical_reasoning: { total: 4, components: {
    orders_monitoring_quality: component(2, 0, 3),
    clinical_reasoning_documentation: component(2, 0, 2),
    safety_deduction: component(0, -2, 0),
  }},
  strengths: ['Focused escalation.'],
  next_steps: ['Document reassessment.'],
  evidence: [{ id: 'event-1', kind: 'order', title: 'STAT CBC', body: 'Observed order.', timestamp: '2026-10-16T00:00:00Z' }],
  scoring_start_at: '2026-10-16T00:00:00Z',
};

describe('canonical feedback contract', () => {
  it('accepts six bounded components and reconciled totals', () => {
    expect(parseCanonicalFeedback(fixture)?.communication.total).toBe(3);
    expect(feedbackDomainArithmetic(fixture.clinical_reasoning.components)).toEqual({ raw: 4, total: 4 });
  });

  it('rejects malformed arithmetic and out-of-range component scores', () => {
    expect(parseCanonicalFeedback({ ...fixture, communication: { ...fixture.communication, total: 4 } })).toBeNull();
    expect(parseCanonicalFeedback({ ...fixture, clinical_reasoning: { ...fixture.clinical_reasoning, components: { ...fixture.clinical_reasoning.components, safety_deduction: component(1, -2, 0) } } })).toBeNull();
  });
});
