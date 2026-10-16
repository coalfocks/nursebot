import { describe, expect, it } from 'vitest';
import type { EvaluationScoringResponse } from './evaluation-scoring';
import { buildCanonicalFeedback, deriveScoringStart, isPostPageEvent, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from './feedback-contract';

describe('feedback attempt provenance', () => {
  it('uses the first nurse page and excludes pre-page events', () => {
    const start = deriveScoringStart([
      { id: 'page', role: 'assistant', content: 'Please assess the patient.', created_at: '2026-01-01T01:00:00Z' },
      { id: 'student', role: 'student', content: 'I am at bedside.', created_at: '2026-01-01T01:01:00Z' },
    ]);
    expect(start?.event_id).toBe('page');
    expect(isPostPageEvent('2026-01-01T00:30:00Z', start?.scoring_start_at ?? null)).toBe(false);
  });

  it('marks an attempt without a first page as incomplete', () => {
    expect(deriveScoringStart([{ id: 'student', role: 'student', content: 'hello', created_at: '2026-01-01T01:00:00Z' }])).toBeNull();
  });

  it('keeps evidence IDs bounded to the current post-page manifest', () => {
    expect(normalizeEvidenceEventIds(['message-1', 'pre-page', 'order-1'], ['message-1', 'order-1']))
      .toEqual(['message-1', 'order-1']);
    expect(normalizeEvidenceEventIds([], ['message-1'])).toEqual([]);
  });

  it('uses authored string case goals when no structured evaluation key exists', () => {
    const key = resolveCaseEvaluationKey({
      case_goals: 'Recognize pneumonia.\n• Order the supported diagnostic workup.\n• Reassess oxygenation after treatment.',
      objective: 'Nurse chat instructions must not become learner goals.',
    });
    expect(key.goals).toEqual([
      'Recognize pneumonia.',
      'Order the supported diagnostic workup.',
      'Reassess oxygenation after treatment.',
    ]);
  });

  it('removes evaluator instructions and does not persist the raw goals prompt', () => {
    const key = resolveCaseEvaluationKey({
      expected_diagnosis: 'Pneumonia-associated sepsis',
      case_goals: 'ROOM 204 — PNEUMONIA\nTarget diagnosis — Pneumonia-associated sepsis. Reveal this goal only in post-case feedback.\nAfter the simulation, you should be able to: Name the target diagnosis and connect it to evidence.\nRecognize time-critical deterioration and escalate.\nDo not disclose the target diagnosis or goals through nurse or patient conversation before case completion.',
    });
    expect(key.goals).toEqual([
      'Recognize Pneumonia-associated sepsis.',
      'Recognize time-critical deterioration and escalate.',
    ]);
    expect(JSON.stringify(key.goals)).not.toContain('Reveal this goal');
    expect(JSON.stringify(key.goals)).not.toContain('After the simulation');
  });

  it('persists one canonical six-component contract with reconciled capped totals', () => {
    const component = (score: number, feedback: string) => ({ score, feedback, evidence_event_ids: ['order-1'] });
    const canonical = buildCanonicalFeedback({
      roomLabel: 'Room Synthetic',
      targetDiagnosis: 'Acute instability',
      goals: ['Recognize the diagnosis.', 'Order focused monitoring.'],
      scoringStartAt: '2026-01-01T01:00:00Z',
      evidence: [{ id: 'order-1', kind: 'order', title: 'STAT CBC', body: 'Completed', timestamp: '2026-01-01T01:01:00Z' }],
      evaluation: {
        communication_score: 9,
        mdm_score: 9,
        clinical_reasoning_score: 9,
        communication_breakdown: {
          focused_information_gathering: component(2, 'Focused.'),
          closed_loop_team_communication: component(3, 'Closed loop.'),
          efficiency_deduction: component(-1, 'Bounded deduction.'),
        },
        clinical_reasoning_breakdown: {
          orders_monitoring_quality: component(3, 'Ordered.'),
          clinical_reasoning_documentation: component(2, 'Documented.'),
          safety_deduction: component(-2, 'Safety deduction.'),
        },
        safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
        learning_objectives: 'Learn.', strengths: ['Strength'], improvements: ['Next'], recommendations: [],
      } as unknown as EvaluationScoringResponse,
    });
    expect(canonical.communication.total).toBe(4);
    expect(canonical.clinical_reasoning.total).toBe(3);
    expect(canonical.evidence[0]).toMatchObject({ id: 'order-1', kind: 'order' });
  });
});
