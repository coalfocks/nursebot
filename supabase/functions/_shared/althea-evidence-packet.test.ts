import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectAttemptEntries, buildEvidencePacket, reconcileEvidence } from './althea-evidence-packet.ts';
import { canonicalizeEvaluation } from './evaluation-scoring.ts';
import { validateFeedbackComments } from './feedback-comments.ts';
import { manifestEventToEvaluationEntry } from './feedback-manifest.ts';
import type { EvaluationTimelineEntry } from './assignment-timeline.ts';

const learnerQuestion: EvaluationTimelineEntry = { id: 'message-10', kind: 'message', timestamp: '2026-11-18T10:01:00Z', title: 'Student message', body: 'What is his oxygen and what were the last vitals?', actor_role: 'student', channel: 'nurse', sequence: 10 };
const nurseReply: EvaluationTimelineEntry = { id: 'message-11', kind: 'message', timestamp: '2026-11-18T10:02:00Z', title: 'Nurse message', body: 'SpO2 91% on room air.', actor_role: 'assistant', channel: 'nurse', sequence: 11 };
const bedside: EvaluationTimelineEntry = { id: 'action:abc', kind: 'learner-action', timestamp: '2026-11-18T10:03:00Z', title: 'Bedside visit', body: 'Went to bedside', actor_role: 'student', channel: 'bedside', sequence: 12 };
const hint: EvaluationTimelineEntry = { id: 'hint:x:oxygen', kind: 'hint', timestamp: '2026-11-18T10:04:00Z', title: 'Hint opened', body: 'Oxygen hint', actor_role: 'student', channel: 'hint', sequence: 13 };
const order: EvaluationTimelineEntry = { id: 'order:o1', kind: 'order', timestamp: '2026-11-18T10:05:00Z', title: 'Order: Lorazepam', body: '2 mg IV', actor_role: 'student', channel: 'orders', sequence: 14 };
// Bedside capture is complete only for attempts activated after bedside telemetry exists.
const opts = { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 2 };

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

describe('whole-attempt capture for bedside-first events', () => {
  it('keeps a bedside visit that happened before the first nurse page', () => {
    const earlyBedside = { ...bedside, id: 'action:early', timestamp: '2026-11-18T09:58:00Z' };
    const attempt = selectAttemptEntries([earlyBedside, learnerQuestion, nurseReply], '2026-11-18T09:50:00Z', '2026-11-18T11:00:00Z');
    const packet = buildEvidencePacket(attempt, opts);
    expect(packet.bedsideEventIds).toEqual(['action:early']);
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
});

describe('invalid comment counts and duplicates are rejected, never padded, truncated, or merged', () => {
  const ids = new Set(['message-10', 'message-11', 'order:o1']);
  const c = (text: string) => ({ text, evidence_event_ids: ['message-10'] });
  const two = [c('First distinct comment.'), c('Second distinct comment.')];
  for (const [name, list] of [['zero', []], ['one', [c('Only one.')]], ['three', [...two, c('A third.')]], ['four', [...two, c('A third.'), c('A fourth.')]]] as const) {
    it(`${name} strengths fails the whole result`, () => {
      expect(validateFeedbackComments({ strengths: list, improvements: two }, ids)).toBeNull();
      expect(validateFeedbackComments({ strengths: two, improvements: list }, ids)).toBeNull();
    });
  }
  it('two comments that differ only by case or spacing fail as duplicates', () => {
    expect(validateFeedbackComments({ strengths: [c('Asked about oxygen.'), c('  ASKED   about oxygen. ')], improvements: two }, ids)).toBeNull();
  });
});

describe('a failed validation preserves the prior saved result', () => {
  const source = readFileSync(resolve(__dirname, '../generate-feedback/index.ts'), 'utf8');
  it('throws on any validation error before the scored run is inserted or the assignment is updated', () => {
    const gate = source.indexOf("if (allValidationErrors.length) throw new Error(`Evidence reconciliation failed; the prior saved result was kept");
    const insert = source.indexOf("insert({ ...provenance, technical_incomplete: false", gate);
    const update = source.indexOf('scoredAssignmentUpdate(evaluation', gate);
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
    expect(update).toBeGreaterThan(gate);
  });
  it('comments-only reruns validate and throw before any insert or update', () => {
    const gate = source.indexOf('Evidence reconciliation failed; prior feedback was preserved');
    const insert = source.indexOf("from('feedback_assessment_runs').insert", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
  });
  it('a commentary that fails count validation is an error, not a saved empty list', () => {
    expect(source).toContain('commentary did not produce exactly two strengths and two improvements');
  });
});
