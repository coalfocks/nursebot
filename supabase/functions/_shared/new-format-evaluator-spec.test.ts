import { describe, expect, it } from 'vitest';
import { canonicalizeEvaluation } from './evaluation-scoring';
import { CANONICAL_RUBRIC, EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { buildEvaluationSheetHtml } from './faculty-study-contract';
import {
  GENERATOR_REVISION_BINDING_KEY,
  NEW_FORMAT_COMPONENT_ANCHORS,
  NEW_FORMAT_EVALUATOR_INSTRUCTION,
  NEW_FORMAT_EVALUATOR_SPEC,
  NEW_FORMAT_EVALUATOR_SPEC_HASH_INPUT,
  NEW_FORMAT_EVALUATOR_SPEC_SHA256,
  NEW_FORMAT_STUDY_ONLY_DEPENDENCIES,
  NEW_FORMAT_EVALUATOR_SPEC_VERSION,
  NEW_FORMAT_EXPECTED_MODEL,
  resolveGeneratorRevisionBinding,
} from './new-format-evaluator-spec';

const ids = ['synthetic-1'];
const component = (score: number, feedback: string) => ({ score, feedback, evidence_event_ids: ids });

const evaluateFixture = (scores: {
  focused: number;
  closedLoop: number;
  efficiency: number;
  orders: number;
  reasoning: number;
  safety: number;
  safetyLevel: 'none' | 'concern' | 'critical';
}) => canonicalizeEvaluation({
  learning_objectives: 'Use observable evidence to plan and reassess.',
  communication_breakdown: {
    focused_information_gathering: component(scores.focused, 'Focused learner-authored information gathering.'),
    closed_loop_team_communication: component(scores.closedLoop, 'Linked learner-authored communication closes the loop.'),
    efficiency_deduction: component(scores.efficiency, 'Context-aware efficiency review.'),
  },
  clinical_reasoning_breakdown: {
    orders_monitoring_quality: component(scores.orders, 'Orders and monitoring are linked to the case.'),
    clinical_reasoning_documentation: component(scores.reasoning, 'Reasoning is linked to observed evidence.'),
    safety_deduction: component(scores.safety, 'Actual-action safety review.'),
  },
  safety_result: { level: scores.safetyLevel, action: scores.safetyLevel === 'none' ? null : 'Synthetic unsafe action', rationale: scores.safetyLevel === 'none' ? null : 'The action was actually captured.', evidence_event_ids: ids },
  strengths: ['Observable strength'], improvements: ['Observable improvement'], recommendations: ['Observable next step'],
});

describe('NEW-FORMAT evaluator specification', () => {
  it('is immutable, explicit, and does not alter the canonical prompt hash input', async () => {
    expect(Object.isFrozen(NEW_FORMAT_EVALUATOR_SPEC)).toBe(true);
    expect(Object.isFrozen(NEW_FORMAT_COMPONENT_ANCHORS)).toBe(true);
    expect(NEW_FORMAT_EVALUATOR_SPEC_VERSION).toBe('new-format-faculty-study-v1');
    expect(NEW_FORMAT_EXPECTED_MODEL).toBe('gpt-6-luna');
    expect(NEW_FORMAT_EVALUATOR_SPEC.generator_revision_binding_key).toBe(GENERATOR_REVISION_BINDING_KEY);
    expect(NEW_FORMAT_EVALUATOR_INSTRUCTION).toContain('Clinical Reasoning');
    expect(NEW_FORMAT_EVALUATOR_INSTRUCTION).toContain('Communication');
    expect(NEW_FORMAT_EVALUATOR_INSTRUCTION).toContain('actual unsafe learner action or order');
    expect(NEW_FORMAT_EVALUATOR_INSTRUCTION).toContain('physical examination');
    expect(NEW_FORMAT_EVALUATOR_INSTRUCTION).toContain('Do not return a Professionalism score, an Overall score');

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${EVALUATION_SYSTEM_PROMPT}\n\n${CANONICAL_RUBRIC}`));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hash).toBe('e92057e12e9e47309412c253f0ecbd90ba371ba67e84267ac16c8b4cf37779ae');

    const specDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(NEW_FORMAT_EVALUATOR_SPEC_HASH_INPUT));
    const specHash = Array.from(new Uint8Array(specDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(specHash).toBe(NEW_FORMAT_EVALUATOR_SPEC_SHA256);
    expect(NEW_FORMAT_STUDY_ONLY_DEPENDENCIES.isolated_tables).toEqual(['faculty_study_batches', 'faculty_study_results']);
    expect(NEW_FORMAT_STUDY_ONLY_DEPENDENCIES.learner_mutation).toContain('none');
  });

  it('publishes every allowed score anchor for all six components', () => {
    expect(Object.keys(NEW_FORMAT_COMPONENT_ANCHORS)).toEqual([
      'focused_information_gathering', 'closed_loop_team_communication', 'efficiency_deduction',
      'orders_monitoring_quality', 'clinical_reasoning_documentation', 'safety_deduction',
    ]);
    expect(Object.entries(NEW_FORMAT_COMPONENT_ANCHORS).every(([, anchor]) => Object.keys(anchor.scores).length === anchor.range[1] - anchor.range[0] + 1)).toBe(true);
    expect(NEW_FORMAT_COMPONENT_ANCHORS.efficiency_deduction.scores[-2]).toContain('severe');
    expect(NEW_FORMAT_COMPONENT_ANCHORS.safety_deduction.scores[-1]).toContain('actual unsafe');
  });

  it('keeps synthetic missing evidence fail-safe', () => {
    const result = evaluateFixture({ focused: 0, closedLoop: 0, efficiency: 0, orders: 0, reasoning: 0, safety: 0, safetyLevel: 'none' });
    expect(result.communication_score).toBe(0);
    expect(result.clinical_reasoning_score).toBe(0);
    expect(result.safety_result.level).toBe('none');
  });

  it('credits bedside-first coherent care without requiring nurse chat', () => {
    const result = evaluateFixture({ focused: 2, closedLoop: 3, efficiency: 0, orders: 3, reasoning: 2, safety: 0, safetyLevel: 'none' });
    expect(result.communication_score).toBe(5);
    expect(result.clinical_reasoning_score).toBe(5);
  });

  it('separates an actual unsafe action from the clinical-reasoning composite', () => {
    const result = evaluateFixture({ focused: 1, closedLoop: 1, efficiency: 0, orders: 3, reasoning: 2, safety: -2, safetyLevel: 'critical' });
    expect(result.clinical_reasoning_score).toBe(3);
    expect(result.safety_result).toMatchObject({ level: 'critical', action: 'Synthetic unsafe action' });
  });

  it('renders readable one-page component feedback without prohibited score or exam attribution', () => {
    const result = evaluateFixture({ focused: 2, closedLoop: 3, efficiency: 0, orders: 3, reasoning: 2, safety: 0, safetyLevel: 'none' });
    const html = buildEvaluationSheetHtml({
      batch_ordinal: 1, specialty: 'ED', case_label: 'Synthetic bedside-first case', packet_label: 'Fixture', status: 'completed', prompt_version: NEW_FORMAT_EVALUATOR_SPEC_VERSION, generated_at: 'synthetic', model: NEW_FORMAT_EXPECTED_MODEL,
      component_scores: { ...result.communication_breakdown, ...result.clinical_reasoning_breakdown },
      domain_scores: { communication: result.communication_score, clinical_reasoning: result.clinical_reasoning_score },
      strengths: result.strengths, improvements: result.improvements, recommendations: result.recommendations,
      communication_breakdown: result.communication_breakdown, clinical_reasoning_breakdown: result.clinical_reasoning_breakdown, evidence_event_ids: ids,
    });
    expect(html).toContain('Focused learner-authored information gathering.');
    expect(html).toContain('<h2>Scores</h2>');
    expect(html).not.toMatch(/physical\s+(?:exam|examination|findings?)/i);
    expect(html).not.toMatch(/Professionalism|Overall score/i);
  });

  it('requires the revision binding only when generation is enabled and stays fail-closed by default', () => {
    const empty = { get: () => undefined };
    expect(resolveGeneratorRevisionBinding('preflight-only', empty)).toBeNull();
    expect(() => resolveGeneratorRevisionBinding('study-enabled', empty)).toThrow('GENERATOR_REVISION_UNVERIFIED');
    expect(resolveGeneratorRevisionBinding('study-enabled', { get: (name) => name === GENERATOR_REVISION_BINDING_KEY ? 'revision-2026-10-24' : undefined })).toBe('revision-2026-10-24');
  });
});
