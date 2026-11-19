import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BEDSIDE_RULE_ALCOHOL_WITHDRAWAL,
  selectAttemptEntries,
  applyBedsideInformationRule,
  applyBedsideRuleToEvaluation,
  buildEvidencePacket,
  reconcileEvidence,
  resolveBedsideExpectation,
  type BedsideExpectationConfig,
} from './althea-evidence-packet.ts';
import { canonicalizeEvaluation } from './evaluation-scoring.ts';
import { manifestEventToEvaluationEntry } from './feedback-manifest.ts';
import { EVALUATION_SYSTEM_PROMPT, ALTHEA_SCORING_PROMPT_VERSION } from './evaluation-prompts.ts';
import { NURSE_ALTHEA_SIMULATION_PROMPT, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256, NURSE_ALTHEA_SIMULATION_PROMPT_ID } from './simulation-prompt.ts';
import { FEEDBACK_COMMENT_PROMPT, validateFeedbackComments } from './feedback-comments.ts';
import { FEEDBACK_RUBRIC_VERSION } from './feedback-contract.ts';
import type { EvaluationTimelineEntry } from './assignment-timeline.ts';

const learnerQuestion: EvaluationTimelineEntry = { id: 'message-10', kind: 'message', timestamp: '2026-11-18T10:01:00Z', title: 'Student message', body: 'What is his oxygen and what were the last vitals?', actor_role: 'student', channel: 'nurse', sequence: 10 };
const nurseReply: EvaluationTimelineEntry = { id: 'message-11', kind: 'message', timestamp: '2026-11-18T10:02:00Z', title: 'Nurse message', body: 'SpO2 91% on room air.', actor_role: 'assistant', channel: 'nurse', sequence: 11 };
const bedside: EvaluationTimelineEntry = { id: 'action:abc', kind: 'learner-action', timestamp: '2026-11-18T10:03:00Z', title: 'Bedside visit', body: 'Went to bedside', actor_role: 'student', channel: 'bedside', sequence: 12 };
const hint: EvaluationTimelineEntry = { id: 'hint:x:oxygen', kind: 'hint', timestamp: '2026-11-18T10:04:00Z', title: 'Hint opened', body: 'Oxygen hint', actor_role: 'student', channel: 'hint', sequence: 13 };
const order: EvaluationTimelineEntry = { id: 'order:o1', kind: 'order', timestamp: '2026-11-18T10:05:00Z', title: 'Order: Lorazepam', body: '2 mg IV', actor_role: 'student', channel: 'orders', sequence: 14 };
const alcoholCase: BedsideExpectationConfig = { expectation: 'required', rule: BEDSIDE_RULE_ALCOHOL_WITHDRAWAL, source: 'case_evaluation', rule_version: 'bedside-rule-v1-2026-11-18' };
// Bedside capture is complete only for attempts activated after bedside telemetry exists.
const opts = { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 2, activatedAt: '2026-12-01T00:00:00Z', telemetrySince: '2026-11-20T00:00:00Z' };

const fullEvaluation = (focused: number) => canonicalizeEvaluation({
  communication_breakdown: {
    focused_information_gathering: { score: focused, feedback: 'Asked focused questions.', evidence_event_ids: ['message-10'] },
    closed_loop_team_communication: { score: 2, feedback: 'Acknowledged reply.', evidence_event_ids: ['message-11'] },
    efficiency_deduction: { score: 0, feedback: 'No interference.', evidence_event_ids: [] },
  },
  clinical_reasoning_breakdown: {
    orders_monitoring_quality: { score: 2, feedback: 'Ordered PRN.', evidence_event_ids: ['order:o1'] },
    clinical_reasoning_documentation: { score: 1, feedback: 'Partial note.', evidence_event_ids: [] },
    safety_deduction: { score: 0, feedback: 'No unsafe action.', evidence_event_ids: [] },
  },
  safety_result: { level: 'none', action: null, rationale: null, evidence_event_ids: [] },
});

describe('bedside expectation resolution', () => {
  it('maps the existing room bedside_requirement column without using the specialty name', () => {
    expect(resolveBedsideExpectation({ bedside_requirement: 'yes', emr_context: null }).expectation).toBe('required');
    expect(resolveBedsideExpectation({ bedside_requirement: 'situational', emr_context: null }).expectation).toBe('optional');
    expect(resolveBedsideExpectation({ bedside_requirement: 'no', emr_context: null }).expectation).toBe('not_applicable');
    expect(resolveBedsideExpectation({ specialty: 'Hospitalist', emr_context: null }).expectation).toBeNull();
  });

  it('prefers an explicit case-level expectation and only enables the alcohol rule when flagged', () => {
    const room = { bedside_requirement: 'no', emr_context: JSON.stringify({ evaluation: { bedsideExpectation: 'required', bedsideRule: BEDSIDE_RULE_ALCOHOL_WITHDRAWAL } }) };
    const config = resolveBedsideExpectation(room);
    expect(config.expectation).toBe('required');
    expect(config.rule).toBe(BEDSIDE_RULE_ALCOHOL_WITHDRAWAL);
    expect(resolveBedsideExpectation({ bedside_requirement: 'yes', emr_context: null }).rule).toBeNull();
  });
});

describe('bedside credit and the alcohol-withdrawal information rule', () => {
  it('credits a recorded bedside visit and makes no deduction', () => {
    const packet = buildEvidencePacket([learnerQuestion, bedside], opts);
    expect(packet.bedsideEventIds).toEqual(['action:abc']);
    const result = applyBedsideInformationRule(2, packet, alcoholCase);
    expect(result.applied).toBe(false);
    expect(result.after).toBe(2);
  });

  it('reduces information gathering by exactly one point when bedside is required and absent in complete capture', () => {
    const packet = buildEvidencePacket([learnerQuestion, nurseReply], opts);
    const result = applyBedsideInformationRule(2, packet, alcoholCase);
    expect(result).toMatchObject({ applied: true, before: 2, after: 1 });
  });

  it('floors at zero and never double-applies', () => {
    const packet = buildEvidencePacket([learnerQuestion], opts);
    expect(applyBedsideInformationRule(0, packet, alcoholCase)).toMatchObject({ applied: false, after: 0 });
    const once = applyBedsideRuleToEvaluation(fullEvaluation(2), packet, alcoholCase);
    expect(once.result.after).toBe(1);
    expect(once.evaluation.communication_breakdown.focused_information_gathering.score).toBe(1);
    expect(once.evaluation.communication_score).toBe(1 + 2 + 0);
  });

  it('makes no deduction for an optional-bedside case, an incomplete capture, or an unassessable score', () => {
    const packet = buildEvidencePacket([learnerQuestion], opts);
    expect(applyBedsideInformationRule(2, packet, { ...alcoholCase, expectation: 'optional' }).applied).toBe(false);
    expect(applyBedsideInformationRule(2, packet, { ...alcoholCase, rule: null }).applied).toBe(false);
    const incomplete = buildEvidencePacket([learnerQuestion], { ...opts, manifestAvailable: false });
    expect(applyBedsideInformationRule(2, incomplete, alcoholCase)).toMatchObject({ applied: false, after: 2 });
    expect(applyBedsideInformationRule(null, packet, alcoholCase)).toMatchObject({ applied: false, after: null });
  });
});

describe('whole-attempt capture for bedside-first events', () => {
  it('keeps a bedside visit that happened before the first nurse page', () => {
    const earlyBedside = { ...bedside, id: 'action:early', timestamp: '2026-11-18T09:58:00Z' };
    const attempt = selectAttemptEntries([earlyBedside, learnerQuestion, nurseReply], '2026-11-18T09:50:00Z', '2026-11-18T11:00:00Z');
    const packet = buildEvidencePacket(attempt, opts);
    expect(packet.bedsideEventIds).toEqual(['action:early']);
    expect(applyBedsideInformationRule(2, packet, alcoholCase)).toMatchObject({ applied: false });
  });

  it('excludes events outside activation and completion and untimed events', () => {
    const before = { ...bedside, id: 'action:before', timestamp: '2026-11-18T09:00:00Z' };
    const after = { ...bedside, id: 'action:after', timestamp: '2026-11-18T12:00:00Z' };
    const untimed = { ...bedside, id: 'action:untimed', timestamp: null };
    const attempt = selectAttemptEntries([before, after, untimed, learnerQuestion], '2026-11-18T09:50:00Z', '2026-11-18T11:00:00Z');
    expect(attempt.map((entry) => entry.id)).toEqual(['message-10']);
  });
});

describe('hint clicks stay separate from learner communication', () => {
  it('maps hint_shown to a hint event rather than a learner message', () => {
    const entry = manifestEventToEvaluationEntry({ event_id: 'hint:a:oxygen', event_type: 'hint_shown', occurred_at: '2026-11-18T10:04:00Z', actor: { role: 'student' }, channel: 'hint', content: { hint_key: 'oxygen' } });
    expect(entry?.kind).toBe('hint');
    expect(entry?.title).toBe('Hint opened');
  });

  it('keeps hint openings out of learner communication and out of bedside evidence', () => {
    const packet = buildEvidencePacket([hint], opts);
    expect(packet.hintEventIds).toEqual(['hint:x:oxygen']);
    expect(packet.learnerCommunicationEventIds).toEqual([]);
    expect(packet.bedsideEventIds).toEqual([]);
  });

  it('labels a bedside_action on the bedside channel as a bedside visit', () => {
    const entry = manifestEventToEvaluationEntry({ event_id: 'action:abc', event_type: 'bedside_action', occurred_at: '2026-11-18T10:03:00Z', actor: { role: 'student' }, channel: 'bedside', content: { text: 'Went to bedside' } });
    expect(entry?.title).toBe('Bedside visit');
    expect(entry?.channel).toBe('bedside');
  });
});

describe('room 203 consistency and reconciliation', () => {
  const packet = buildEvidencePacket([learnerQuestion, nurseReply, order], opts);

  it('fails validation when text says no communication was captured while the packet holds learner questions', () => {
    const errors = reconcileEvidence({
      packet,
      texts: ['No learner communication was captured in this attempt.'],
      componentEvidenceIds: ['message-10'],
      commentEvidenceIds: ['message-10'],
    });
    expect(errors.join(' ')).toMatch(/no communication was captured/);
  });

  it('passes consistent text that describes the captured questions and team instructions', () => {
    const errors = reconcileEvidence({
      packet,
      texts: ['You asked the nurse about oxygen and vitals, and you relayed the team instruction clearly.'],
      componentEvidenceIds: ['message-10', 'message-11'],
      commentEvidenceIds: ['message-10', 'order:o1'],
    });
    expect(errors).toEqual([]);
  });

  it('rejects evidence IDs outside the packet and a claim that the bedside visit did not happen', () => {
    const withBedside = buildEvidencePacket([learnerQuestion, bedside], opts);
    const errors = reconcileEvidence({
      packet: withBedside,
      texts: ['The learner did not go to bedside before ordering.'],
      componentEvidenceIds: ['message-999'],
      commentEvidenceIds: [],
    });
    expect(errors.length).toBe(2);
  });

  it('exposes the explicit captured counts in the prompt packet, so the model cannot describe them as empty', () => {
    const summary = buildEvidencePacket([learnerQuestion], opts);
    expect(summary.learnerCommunicationEventIds).toEqual(['message-10']);
    expect(summary.baselineMedicationsAndOrders).toBe('unavailable');
  });
});

describe('scoring prompt and version', () => {
  it('installs the approved simulation prompt verbatim and records its ID and hash', () => {
    expect(ALTHEA_SCORING_PROMPT_VERSION).toBe('nurse-althea-simulation-evidence-v1-2026-11-18');
    expect(NURSE_ALTHEA_SIMULATION_PROMPT_ID).toBe('nurse-althea-simulation-evidence-v1-2026-11-18');
    expect(EVALUATION_SYSTEM_PROMPT.startsWith(NURSE_ALTHEA_SIMULATION_PROMPT)).toBe(true);
    expect(createHash('sha256').update(NURSE_ALTHEA_SIMULATION_PROMPT, 'utf8').digest('hex')).toBe(NURSE_ALTHEA_SIMULATION_PROMPT_SHA256);
  });

  it('bumps the rubric version for the safety evidence rule', () => {
    expect(FEEDBACK_RUBRIC_VERSION).toBe('feedback-v8-althea-2026-11-19');
  });

  it('removes the legacy rules that demanded administration proof and penalized a missing clinical-exam claim', () => {
    expect(EVALUATION_SYSTEM_PROMPT).not.toContain('Mark an action as ordered, administered, or completed only when that status is recorded.');
    expect(EVALUATION_SYSTEM_PROMPT).not.toContain('or a clinical examination was performed unless the simulation records that action');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('Do not require a medication administration record');
  });

  it('keeps the approved anchors: ranges, safety mapping, and both domain formulas', () => {
    expect(EVALUATION_SYSTEM_PROMPT).toContain('COMMUNICATION SCORE (0–5)');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('MEDICAL DECISION-MAKING SCORE (0–5)');
    expect(EVALUATION_SYSTEM_PROMPT).toContain('For Safety, map none to 0, concern to −1, and critical to −2.');
  });
});

describe('exactly two strengths and two improvements', () => {
  const ids = new Set(['message-10', 'message-11', 'order:o1']);
  const comment = (text: string, evidence_event_ids = ['message-10']) => ({ text, evidence_event_ids });

  it('accepts exactly two of each with valid evidence', () => {
    const result = validateFeedbackComments({ strengths: [comment('You asked about oxygen.'), comment('You ordered PRN.', ['order:o1'])], improvements: [comment('Repeat vitals sooner.'), comment('Name the reassessment time.', ['message-11'])] }, ids);
    expect(result?.status).toBe('generated');
  });

  it('rejects a single strength instead of padding it', () => {
    expect(validateFeedbackComments({ strengths: [comment('You asked about oxygen.')], improvements: [comment('a'), comment('b')] }, ids)).toBeNull();
  });

  it('instructs one or two sentences per comment', () => {
    expect(FEEDBACK_COMMENT_PROMPT).toContain('one or two sentences per comment');
    expect(FEEDBACK_COMMENT_PROMPT).toContain('never describe communication as absent');
  });
});
