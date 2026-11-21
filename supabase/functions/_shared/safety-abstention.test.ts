import { describe, it, expect } from 'vitest';
import { canonicalizeEvaluation, safetyConsistencyErrors } from './evaluation-scoring';
import { assertCompleteEvaluation } from './feedback-operations';
const component = { score: 1, feedback: 'observed', evidence_event_ids: ['event:1'], not_scored_reason: null };
const candidate = (safety: unknown, level = 'not_assessed') => ({ communication_breakdown: { focused_information_gathering: component, closed_loop_team_communication: component, efficiency_deduction: { ...component, score: 0 } }, clinical_reasoning_breakdown: { orders_monitoring_quality: component, clinical_reasoning_documentation: component, safety_deduction: safety }, safety_result: { level, action: null, rationale: 'Source unavailable', evidence_event_ids: [] } });
describe('explicit safety abstention conversion', () => {
 it('preserves explained null, evidence and feedback without manufacturing a total', () => {
  const safety = { score: null, feedback: 'Cannot assess authorship', not_scored_reason: 'Authorship cannot be verified.', evidence_event_ids: ['event:1'] };
  const result = canonicalizeEvaluation(candidate(safety) as never);
  expect(result.mdm_breakdown.safety_deduction).toEqual(safety);
  expect(result.mdm_score).toBeNull();
  expect(result.safety_result.level).toBe('not_assessed');
  expect(() => assertCompleteEvaluation(result)).not.toThrow();
  expect(safetyConsistencyErrors(result)).toEqual([]);
 });
 it.each([undefined, { score: null }, { score: null, not_scored_reason: ' ' }, { score: 0, not_scored_reason: 'unknown' }, { score: 'invalid', not_scored_reason: 'unknown' }])('rejects invalid abstention %j', safety => {
  expect(() => assertCompleteEvaluation(canonicalizeEvaluation(candidate(safety) as never))).toThrow();
 });
 it('rejects concern without a numeric deduction', () => {
  expect(() => assertCompleteEvaluation(canonicalizeEvaluation(candidate({ score: null, not_scored_reason: 'unknown' }, 'concern') as never))).toThrow();
 });
 it('rejects actual concern/zero contradiction', () => {
  expect(safetyConsistencyErrors(canonicalizeEvaluation(candidate({ ...component, score: 0 }, 'concern') as never))).toHaveLength(1);
 });
});
