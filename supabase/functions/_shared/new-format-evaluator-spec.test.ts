import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalizeEvaluation } from './evaluation-scoring';
import { CANONICAL_RUBRIC, EVALUATION_SYSTEM_PROMPT } from './evaluation-prompts';
import { buildEvaluationSheetHtml, deidentifyStudyResult, proveRenderedSheetStructure } from './faculty-study-contract';
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
  assertReviewedNewFormatBinding,
  resolveGeneratorRevisionBinding,
  stableCanonicalJson,
} from './new-format-evaluator-spec';
import { validateEvidenceAttributions } from './evaluation-scoring';
import { SYNTHETIC_NEW_FORMAT_SHEET_RESULT } from './new-format-sheet-fixture';

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

  it('rejects every enabled-path binding mismatch before generation', () => {
    const valid = {
      prompt_version: NEW_FORMAT_EVALUATOR_SPEC_VERSION,
      prompt_text: NEW_FORMAT_EVALUATOR_INSTRUCTION,
      evaluator_spec_version: NEW_FORMAT_EVALUATOR_SPEC_VERSION,
      evaluator_spec_hash: NEW_FORMAT_EVALUATOR_SPEC_SHA256,
      component_anchors: NEW_FORMAT_COMPONENT_ANCHORS,
      expected_model: NEW_FORMAT_EXPECTED_MODEL,
      generator_revision: 'revision-2026-10-24',
    };
    expect(assertReviewedNewFormatBinding(valid)).toBe(true);
    const reorderedAnchors = Object.fromEntries(Object.entries(NEW_FORMAT_COMPONENT_ANCHORS).reverse().map(([key, value]) => [key, Object.fromEntries(Object.entries(value).reverse().map(([nestedKey, nestedValue]) => [nestedKey, nestedValue]))]));
    expect(stableCanonicalJson(reorderedAnchors)).toBe(stableCanonicalJson(NEW_FORMAT_COMPONENT_ANCHORS));
    expect(assertReviewedNewFormatBinding({ ...valid, component_anchors: reorderedAnchors })).toBe(true);
    expect(() => assertReviewedNewFormatBinding({ ...valid, component_anchors: { ...reorderedAnchors, safety_deduction: { ...reorderedAnchors.safety_deduction, scores: { ...reorderedAnchors.safety_deduction.scores, '-1': 'changed' } } } })).toThrow('ANCHORS_MISMATCH');
    for (const key of ['prompt_version', 'prompt_text', 'evaluator_spec_version', 'evaluator_spec_hash', 'component_anchors', 'expected_model', 'generator_revision'] as const) {
      expect(() => assertReviewedNewFormatBinding({ ...valid, [key]: key === 'generator_revision' ? '' : 'mismatch' })).toThrow();
    }
  });

  it('proves the actual synthetic printable PDF is one page', () => {
    const html = buildEvaluationSheetHtml({
      batch_ordinal: 1, specialty: 'ED', case_label: 'Synthetic', packet_label: 'Fixture', status: 'completed', prompt_version: NEW_FORMAT_EVALUATOR_SPEC_VERSION, model: NEW_FORMAT_EXPECTED_MODEL,
      case_goals: ['Recognize deterioration', 'Escalate and reassess'], critical_safety_action: 'Do not administer the contraindicated order.', safety_result: { level: 'critical', action: 'Do not administer the contraindicated order.' },
      component_scores: { focused_information_gathering: 2, closed_loop_team_communication: 3, efficiency_deduction: 0, orders_monitoring_quality: 3, clinical_reasoning_documentation: 2, safety_deduction: -2 }, domain_scores: { communication: 5, clinical_reasoning: 3 },
    });
    const pdf = new Uint8Array(readFileSync('artifacts/new-format-sheet-proof.pdf'));
    expect(proveRenderedSheetStructure(html, pdf)).toEqual({ valid: true, missing: [], page_count: 1 });
    expect(html).toContain('Recognize deterioration');
    expect(html).toContain('Do not administer the contraindicated order.');
  });

  it('preserves source narrative wording in the printable sheet', () => {
    const sourceNarrative = 'The learner performed a physical examination; physical findings were documented.';
    const html = buildEvaluationSheetHtml({
      batch_ordinal: 1, specialty: 'ED', case_label: 'Synthetic', packet_label: 'Fixture', status: 'completed',
      component_scores: { focused_information_gathering: { score: 1, feedback: sourceNarrative } },
      domain_scores: {},
    });
    expect(html).toContain('The learner performed a physical examination; physical findings were documented.');
    expect(html).not.toContain('simulated bedside interaction');
  });

  it('flags unsupported positive exam attribution without rewriting the source wording or crediting it', () => {
    const evaluation = canonicalizeEvaluation({
      learning_objectives: 'The learner performed a physical examination.',
      communication_breakdown: {
        focused_information_gathering: component(2, 'The learner performed a physical examination.'),
        closed_loop_team_communication: component(0, 'No linked communication.'),
        efficiency_deduction: component(0, 'No deduction.'),
      },
      clinical_reasoning_breakdown: {
        orders_monitoring_quality: component(0, 'No orders.'),
        clinical_reasoning_documentation: component(2, 'The learner performed a physical examination.'),
        safety_deduction: component(0, 'No unsafe action.'),
      },
      safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
    });
    const checked = validateEvidenceAttributions(evaluation, [{ kind: 'message', title: 'Nurse page', body: 'Patient is dizzy.', meta: ['Actor: nurse'] }]);
    expect(checked.evidence_validation_warnings?.[0]).toContain('UNSUPPORTED_ATTRIBUTION');
    expect(checked.communication_breakdown.focused_information_gathering.feedback).toContain('physical examination');
    expect(checked.communication_breakdown.focused_information_gathering.score).toBe(0);
    expect(checked.clinical_reasoning_breakdown.clinical_reasoning_documentation.score).toBe(0);
    const reviewer = deidentifyStudyResult({ batch_ordinal: 1, specialty: 'ED', case_label: 'Synthetic', packet_label: 'Fixture', status: 'completed', evaluation: checked, redaction_terms: [] }) as Record<string, unknown>;
    expect(reviewer.evidence_validation_warnings).toEqual(checked.evidence_validation_warnings);
    expect(buildEvaluationSheetHtml(reviewer)).toContain('UNSUPPORTED_ATTRIBUTION');
    const quoted = validateEvidenceAttributions(canonicalizeEvaluation({ learning_objectives: 'The note says “The learner performed a physical examination.”', communication_breakdown: { focused_information_gathering: component(1, 'Quoted source only.') }, clinical_reasoning_breakdown: {}, safety_result: { level: 'none', evidence_event_ids: [] } }), [{ kind: 'message', title: 'Nurse page', meta: ['Actor: nurse'] }]);
    expect(quoted.evidence_validation_warnings).toEqual([]);
  });

  it('requires claim-specific learner evidence content and preserves mixed quoted, negative, and positive wording', () => {
    const evaluation = canonicalizeEvaluation({
      communication_breakdown: {
        focused_information_gathering: component(2, 'The learner performed a physical examination. The record says “The learner performed a physical examination.” No evidence that the learner performed a physical examination.'),
      },
      clinical_reasoning_breakdown: {},
      safety_result: { level: 'none', evidence_event_ids: [] },
    });
    const checked = validateEvidenceAttributions(evaluation, [
      { id: 'unrelated', kind: 'learner-action', title: 'Learner team escalation', body: 'Escalated the patient to the senior clinician.', meta: ['Author: Student'] },
    ]);
    expect(checked.evidence_validation_warnings).toHaveLength(1);
    expect(checked.communication_breakdown.focused_information_gathering.score).toBe(0);
    expect(checked.communication_breakdown.focused_information_gathering.feedback).toContain('The learner performed a physical examination.');
  });

  it('accepts only an ID-linked learner entry whose content supports the physical-exam wording', () => {
    const evaluation = canonicalizeEvaluation({
      communication_breakdown: { focused_information_gathering: { score: 2, feedback: 'The learner performed a physical examination.', evidence_event_ids: ['exam'] } },
      clinical_reasoning_breakdown: {}, safety_result: { level: 'none', evidence_event_ids: [] },
    });
    const checked = validateEvidenceAttributions(evaluation, [{ id: 'exam', kind: 'learner-action', title: 'Learner bedside finding', body: 'Physical exam findings documented at bedside.', meta: ['Author: Student'] }]);
    expect(checked.evidence_validation_warnings).toEqual([]);
    expect(checked.communication_breakdown.focused_information_gathering.score).toBe(2);
  });

  it('uses the exact shared sheet fixture for the checked-in HTML artifact', async () => {
    const html = buildEvaluationSheetHtml(SYNTHETIC_NEW_FORMAT_SHEET_RESULT);
    const artifact = readFileSync('artifacts/new-format-sheet-proof.html', 'utf8');
    expect(artifact).toBe(html);
    const metadata = JSON.parse(readFileSync('artifacts/new-format-sheet-proof.json', 'utf8')) as Record<string, unknown>;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
    const htmlSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const pdf = readFileSync('artifacts/new-format-sheet-proof.pdf');
    const pdfDigest = await crypto.subtle.digest('SHA-256', pdf);
    const pdfSha256 = Array.from(new Uint8Array(pdfDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(metadata.html_sha256).toBe(htmlSha256);
    expect(metadata.pdf_sha256).toBe(pdfSha256);
    expect(metadata.pdf_byte_size).toBe(pdf.byteLength);
    expect(metadata.page_count).toBe(1);
    expect(proveRenderedSheetStructure(artifact, new Uint8Array(pdf))).toEqual({ valid: true, missing: [], page_count: 1 });
  });
});
