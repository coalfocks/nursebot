import { describe, expect, it, vi } from 'vitest';
import { assertCompleteEvaluation, requestSectionWithLengthRetry } from './feedback-operations';
import { canonicalizeEvaluation } from './evaluation-scoring';
const component = { score: 0, feedback: 'Observed.', evidence_event_ids: [], not_scored_reason: null };
const raw = {
 communication_breakdown: { focused_information_gathering: component, closed_loop_team_communication: component, efficiency_deduction: component },
 clinical_reasoning_breakdown: { orders_monitoring_quality: component, clinical_reasoning_documentation: component, safety_deduction: component },
 safety_result: { level: 'none' },
};
describe('technical completeness before persistence/reuse', () => {
 it('rejects the IM-07 failure shape before any save', () => {
  const save = vi.fn();
  const evaluation = canonicalizeEvaluation({ ...raw, communication_breakdown: {} } as any);
  expect(() => { assertCompleteEvaluation(evaluation, { communication: 'Model returned no content (finish_reason=length)' }); save(evaluation); }).toThrow(/communication: Model returned no content/);
  expect(save).not.toHaveBeenCalled();
 });
 it('rejects syntactically valid but missing/invalid components even without a section error', () => {
  for (const value of [{ ...raw, communication_breakdown: {} }, { ...raw, communication_breakdown: { ...raw.communication_breakdown, efficiency_deduction: { score: 9 } } }]) {
   expect(() => assertCompleteEvaluation(canonicalizeEvaluation(value as any))).toThrow(/missing or invalid/);
  }
 });
 it('accepts complete results and explicit evidence-based abstention', () => {
  expect(() => assertCompleteEvaluation(canonicalizeEvaluation(raw as any))).not.toThrow();
  const abstention = { score: null, feedback: 'Source unavailable.', evidence_event_ids: [], not_scored_reason: 'Patient message source unavailable.' };
  expect(() => assertCompleteEvaluation(canonicalizeEvaluation({ ...raw, communication_breakdown: { ...raw.communication_breakdown, focused_information_gathering: abstention } } as any))).not.toThrow();
 });
 it('retries length failure exactly once with a larger budget', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Model returned no content (finish_reason=length)')).mockResolvedValueOnce(raw);
  expect(await requestSectionWithLengthRetry(request, 4000)).toBe(raw);
  expect(request.mock.calls).toEqual([[4000], [8000]]);
 });
 it('does not loop or retry unrelated errors', async () => {
  const length = vi.fn().mockRejectedValue(new Error('finish_reason=length'));
  await expect(requestSectionWithLengthRetry(length, 4000)).rejects.toThrow('length');
  expect(length).toHaveBeenCalledTimes(2);
  const other = vi.fn().mockRejectedValue(new Error('provider rejected request'));
  await expect(requestSectionWithLengthRetry(other, 4000)).rejects.toThrow('provider rejected');
  expect(other).toHaveBeenCalledTimes(1);
 });
});
