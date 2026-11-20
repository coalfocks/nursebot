import { describe, expect, it } from 'vitest';
import {
  buildEvidencePacket,
  resolveOrderAuthorship,
  pairRequestAcknowledgments,
  reconcileEvidence,
  resolveClosedLoopEvidence,
} from './althea-evidence-packet.ts';
import { manifestEventToEvaluationEntry } from './feedback-manifest.ts';
import { safetyConsistencyErrors } from './evaluation-scoring.ts';
import type { EvaluationTimelineEntry } from './assignment-timeline.ts';
import { validateFeedbackComments } from './feedback-comments.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Manifest-shaped events copied from attempt 2808c092 (Room 203, completed 2026-05-06).
// Text is trimmed to the parts the pipeline reads. Mapping goes through the real manifest mapper.
const ROOM_203_ASSIGNMENT = '2808c092-d44f-4078-88be-954f11e0ffa3';
// Order events come from the manifest's assignment-scoped query, so they always link this assignment.
const manifestEvent = (eventId: string, eventType: string, role: string, occurredAt: string, text: string, extra: Record<string, unknown> = {}) => ({
  event_id: eventId,
  event_type: eventType,
  actor: { role },
  channel: extra.channel ?? 'nurse',
  occurred_at: occurredAt,
  sequence: null,
  ordering_ambiguous: false,
  content: { text },
  ...(eventType === 'order_placed' ? { links: { assignment_id: ROOM_203_ASSIGNMENT } } : {}),
  ...extra,
});

const ROOM_203_SCORING_START = '2026-05-06T16:51:16.446187+00:00';
const room203Events = [
  manifestEvent('chat:e619289b', 'nurse_message', 'assistant', ROOM_203_SCORING_START, 'Hi, this is the nurse for Mr. Poppy in 203 — he is suddenly much more short of breath and I have put him on a non-rebreather mask.'),
  manifestEvent('chat:84b4e108', 'student_message', 'student', '2026-05-06T16:52:41.173988+00:00', 'Hi, what is his current O2 saturation? What non-rebreather settings did you set it at? Any other important vitals?'),
  manifestEvent('chat:ea246d21', 'nurse_message', 'assistant', '2026-05-06T16:52:43.163960+00:00', 'His O2 sat was 71% on room air and is now 83% on the non-rebreather at 15 L/min. Do you want any changes to his oxygen or further orders?'),
  manifestEvent('chat:b360c4ba', 'student_message', 'student', '2026-05-06T16:56:28.706197+00:00', 'I am coming to bedside now. Please keep him on the non-rebreather at 15 L/min and place him on continuous pulse ox and telemetry. Can you also get a stat ABG, repeat chest X-ray, CBC, CMP, lactate, troponin, BNP, blood cultures and EKG?'),
  manifestEvent('chat:5b2d37c0', 'nurse_message', 'assistant', '2026-05-06T16:56:31.692167+00:00', 'I am not at the computer right now. Have you placed those orders in the EMR yet? I will notify respiratory therapy to prepare for high-flow nasal cannula.'),
  manifestEvent('chat:fcd63d97', 'student_message', 'student', '2026-05-06T16:59:55.181822+00:00', 'I have just placed those orders.'),
  manifestEvent('chat:3d05e2fe', 'nurse_message', 'assistant', '2026-05-06T16:59:57.162217+00:00', 'Thank you. I will proceed with the stat ABG, labs, repeat chest X-ray, EKG, and notify respiratory therapy for high-flow nasal cannula setup.'),
  manifestEvent('order:a188ff44', 'order_placed', 'unknown', '2026-05-06T16:57:20.305+00:00', 'Complete Blood Count with Differential', { channel: 'orders', content: { name: 'Complete Blood Count with Differential', category: 'Lab', status: 'Active' } }),
  manifestEvent('order:df5b6a30', 'order_placed', 'unknown', '2026-05-06T16:57:50.611+00:00', 'ABG with Co-oximetry', { channel: 'orders', content: { name: 'ABG with Co-oximetry', category: 'Lab', status: 'Active' } }),
];
const room203Entries = resolveOrderAuthorship(room203Events.map(manifestEventToEvaluationEntry).filter((entry): entry is EvaluationTimelineEntry => Boolean(entry)));
const room203Packet = buildEvidencePacket(room203Entries, { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 5 });
const opts = { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 5 };
const learnerQuestion: EvaluationTimelineEntry = { id: 'message-10', kind: 'message', timestamp: '2026-11-18T10:01:00Z', title: 'Student message', body: 'What is his oxygen?', actor_role: 'student', channel: 'nurse' };
const nurseReply: EvaluationTimelineEntry = { id: 'message-11', kind: 'message', timestamp: '2026-11-18T10:02:00Z', title: 'Nurse message', body: 'SpO2 91%.', actor_role: 'assistant', channel: 'nurse' };

describe('Room 203 closed-loop evidence (attempt 2808c092)', () => {
  it('holds the learner nurse-chat requests and orders in the packet the scorer reads', () => {
    expect(room203Packet.learnerCommunicationEventIds).toEqual(expect.arrayContaining(['chat:84b4e108', 'chat:b360c4ba', 'chat:fcd63d97']));
    expect(room203Packet.learnerOrderEventIds).toEqual(['order:a188ff44', 'order:df5b6a30']);
  });

  it('offers learner nurse-chat requests as closed-loop candidates (the previous list dropped them)', () => {
    expect(room203Packet.closedLoopEventIds).toEqual(expect.arrayContaining(['chat:b360c4ba', 'chat:fcd63d97']));
  });

  it('links the request to the nurse acknowledgment through the curly-apostrophe reply', () => {
    expect(room203Packet.requestAcknowledgmentPairs).toContainEqual({ request_id: 'chat:b360c4ba', acknowledgment_id: 'chat:5b2d37c0' });
  });

  it('rejects the saved "no linked learner team communication was captured" wording', () => {
    const errors = reconcileEvidence({
      packet: room203Packet,
      texts: ['Not observed: no linked learner team communication was captured.'],
      componentEvidenceIds: [],
      commentEvidenceIds: [],
    });
    expect(errors.some((error) => error.includes('no communication was captured'))).toBe(true);
  });

  it('rejects "no orders captured" text when the packet holds learner orders', () => {
    const errors = reconcileEvidence({ packet: room203Packet, texts: ['No learner orders were captured in this attempt.'], componentEvidenceIds: [], commentEvidenceIds: [] });
    expect(errors.some((error) => error.includes('no order was captured'))).toBe(true);
  });

  it('accepts accurate learner-action text without a contradiction', () => {
    const errors = reconcileEvidence({
      packet: room203Packet,
      texts: ['You asked for oxygen saturation and NRB settings, then placed stat ABG and CBC orders.'],
      componentEvidenceIds: ['chat:84b4e108', 'order:df5b6a30'],
      commentEvidenceIds: ['chat:b360c4ba'],
    });
    expect(errors).toEqual([]);
  });

  it('keeps a request-to-acknowledgment pair only when the nurse answers before the learner speaks again', () => {
    const request: EvaluationTimelineEntry = { id: 'chat:req', kind: 'message', timestamp: '2026-11-18T10:00:00Z', title: 'Student message', body: 'Please give the PRN lorazepam now.', actor_role: 'student', channel: 'nurse' };
    const learnerFirst: EvaluationTimelineEntry = { id: 'chat:learner-again', kind: 'message', timestamp: '2026-11-18T10:01:00Z', title: 'Student message', body: 'Actually, never mind.', actor_role: 'student', channel: 'nurse' };
    const ack: EvaluationTimelineEntry = { id: 'chat:ack', kind: 'message', timestamp: '2026-11-18T10:02:00Z', title: 'Nurse message', body: 'I will give it.', actor_role: 'assistant', channel: 'nurse' };
    expect(pairRequestAcknowledgments([request, ack])).toEqual([{ request_id: 'chat:req', acknowledgment_id: 'chat:ack' }]);
    expect(pairRequestAcknowledgments([request, learnerFirst, ack])).toEqual([]);
  });

  it('does not pair an acknowledgment that arrives after the window', () => {
    const request: EvaluationTimelineEntry = { id: 'chat:req', kind: 'message', timestamp: '2026-11-18T10:00:00Z', title: 'Student message', body: 'Please give the PRN now.', actor_role: 'student', channel: 'nurse' };
    const late: EvaluationTimelineEntry = { id: 'chat:late', kind: 'message', timestamp: '2026-11-18T10:30:00Z', title: 'Nurse message', body: 'I will give it.', actor_role: 'assistant', channel: 'nurse' };
    expect(pairRequestAcknowledgments([request, late])).toEqual([]);
  });
});

describe('closed-loop score must link to evidence', () => {
  const candidates = ['chat:b360c4ba', 'chat:fcd63d97'];
  const pairs = [{ request_id: 'chat:b360c4ba', acknowledgment_id: 'chat:5b2d37c0' }];
  const sources = [...candidates, 'chat:5b2d37c0'];

  it('keeps model-cited IDs that are valid closed-loop candidates', () => {
    expect(resolveClosedLoopEvidence({ requestedIds: ['chat:b360c4ba'], score: 2, candidateIds: candidates, pairs, sourceEventIds: sources })).toEqual({ evidenceIds: ['chat:b360c4ba'], error: null });
  });

  it('uses the deterministic request/acknowledgment pair when every cited ID was rejected', () => {
    // Previously the model's IDs (nurse-chat requests) were filtered out, leaving a positive score with no evidence.
    const result = resolveClosedLoopEvidence({ requestedIds: ['chat:not-in-packet'], score: 2, candidateIds: candidates, pairs, sourceEventIds: sources });
    expect(result.error).toBeNull();
    expect(result.evidenceIds).toEqual(expect.arrayContaining(['chat:b360c4ba', 'chat:5b2d37c0']));
  });

  it('fails the run when a positive closed-loop score has no linked evidence at all', () => {
    const result = resolveClosedLoopEvidence({ requestedIds: [], score: 1, candidateIds: [], pairs: [], sourceEventIds: sources });
    expect(result.error).toContain('scored 1 with no linked learner request or acknowledgment');
  });

  it('allows a zero closed-loop score without a positive claim', () => {
    expect(resolveClosedLoopEvidence({ requestedIds: [], score: null, candidateIds: candidates, pairs, sourceEventIds: sources }).error).toBeNull();
  });
});

describe('PRN request with nurse acknowledgment (no duplicate order, MAR, or administration proof)', () => {
  it('counts the learner request and nurse acknowledgment as closed-loop evidence without any MAR or order event', () => {
    const request = manifestEventToEvaluationEntry(manifestEvent('chat:prn-req', 'student_message', 'student', '2026-11-18T10:00:00Z', 'Can you give his PRN lorazepam now for the agitation?'));
    const ack = manifestEventToEvaluationEntry(manifestEvent('chat:prn-ack', 'nurse_message', 'assistant', '2026-11-18T10:01:00Z', "I'll give it."));
    const packet = buildEvidencePacket([request!, ack!], opts);
    expect(packet.requestAcknowledgmentPairs).toEqual([{ request_id: 'chat:prn-req', acknowledgment_id: 'chat:prn-ack' }]);
    expect(packet.learnerOrderEventIds).toEqual([]);
    expect(packet.baselineMedicationsAndOrders).toBe('unavailable');
  });
});

describe('safety level and safety deduction must agree', () => {
  const evaluation = (level: 'none' | 'concern' | 'critical' | 'not_assessed', score: number | null) => ({
    safety_result: { level, action: null, rationale: null, evidence_event_ids: [] },
    mdm_breakdown: { safety_deduction: { score, feedback: '', evidence_event_ids: [] } },
  });

  it('accepts the approved mapping none=0, concern=-1, critical=-2', () => {
    expect(safetyConsistencyErrors(evaluation('none', 0))).toEqual([]);
    expect(safetyConsistencyErrors(evaluation('concern', -1))).toEqual([]);
    expect(safetyConsistencyErrors(evaluation('critical', -2))).toEqual([]);
  });

  it('fails the attempt that saved level none with a -1 deduction (attempt 15be67e9)', () => {
    const errors = safetyConsistencyErrors(evaluation('none', -1));
    expect(errors).toEqual(['safety mismatch: level none requires a deduction of 0 but the saved deduction is -1']);
  });

  it('fails a concern label with no deduction and a not_assessed level with a score', () => {
    expect(safetyConsistencyErrors(evaluation('concern', null))).toHaveLength(1);
    expect(safetyConsistencyErrors(evaluation('not_assessed', -1))).toHaveLength(1);
    expect(safetyConsistencyErrors(evaluation('not_assessed', null))).toEqual([]);
  });
});

describe('exactly two strengths and two improvements', () => {
  const comment = (text: string, id: string) => ({ text, evidence_event_ids: [id] });
  const allowed = new Set(['chat:a', 'chat:b', 'chat:c', 'chat:d', 'chat:e']);

  it('accepts exactly two strengths and two improvements', () => {
    const result = validateFeedbackComments({
      strengths: [comment('You asked for oxygen saturation.', 'chat:a'), comment('You placed the ABG order.', 'chat:b')],
      improvements: [comment('Go to the bedside sooner.', 'chat:c'), comment('Say when you will reassess.', 'chat:d')],
    }, allowed);
    expect(result?.status).toBe('generated');
  });

  it('rejects the one-strength sheet shape', () => {
    expect(validateFeedbackComments({
      strengths: [comment('You asked for oxygen saturation.', 'chat:a')],
      improvements: [comment('Go to the bedside sooner.', 'chat:c'), comment('Say when you will reassess.', 'chat:d')],
    }, allowed)).toBeNull();
  });

  it('rejects comments that cite events outside the packet', () => {
    expect(validateFeedbackComments({
      strengths: [comment('You asked for oxygen saturation.', 'chat:zzz'), comment('You placed the ABG order.', 'chat:b')],
      improvements: [comment('Go to the bedside sooner.', 'chat:c'), comment('Say when you will reassess.', 'chat:d')],
    }, allowed)).toBeNull();
  });
});

describe('order authorship: observed, inferred, unknown', () => {
  const learnerRequest = (id: string, ts: string, body: string): EvaluationTimelineEntry => ({ id, kind: 'message', timestamp: ts, title: 'Student message', body, actor_role: 'student', channel: 'nurse' });
  const orderAt = (id: string, ts: string, name: string, role = 'unknown', linked = true): EvaluationTimelineEntry => ({
    ...manifestEventToEvaluationEntry(manifestEvent(id, 'order_placed', role, ts, name, { channel: 'orders', content: { name } }))!,
    assignment_linked: linked,
  });

  it('observed: a recorded learner actor is credited as observed, without inference', () => {
    const [entry] = resolveOrderAuthorship([orderAt('order:o-obs', '2026-05-06T16:57:20Z', 'Lactate', 'student')]);
    expect(entry.authorship).toBe('observed');
    expect(buildEvidencePacket([entry], opts).observedOrderEventIds).toEqual(['order:o-obs']);
  });

  it('inferred: assignment-linked, no actor, and a learner request naming the order', () => {
    const request = learnerRequest('chat:req', '2026-05-06T16:56:28Z', 'Can you also get a stat ABG and CBC?');
    const resolved = resolveOrderAuthorship([request, orderAt('order:abg', '2026-05-06T16:57:50Z', 'ABG with Co-oximetry')]);
    const order = resolved.find((entry) => entry.id === 'order:abg')!;
    expect(order.authorship).toBe('inferred');
    expect(order.actor_role).toBe('student');
    expect(order.meta?.join(' ')).toContain('inferred');
    const packet = buildEvidencePacket(resolved, opts);
    expect(packet.inferredOrderEventIds).toEqual(['order:abg']);
    expect(packet.learnerOrderEventIds).toEqual(['order:abg']);
  });

  it('inferred: a learner placement confirmation shortly after the order corroborates it', () => {
    const confirm = learnerRequest('chat:confirm', '2026-05-06T16:59:55Z', 'I have just placed those orders.');
    const [order] = resolveOrderAuthorship([orderAt('order:cbc', '2026-05-06T16:57:20Z', 'Complete Blood Count with Differential'), confirm]).filter((entry) => entry.kind === 'order');
    expect(order.authorship).toBe('inferred');
  });

  it('unknown: matching room or timestamp alone is not enough (no assignment link, no learner corroboration)', () => {
    const unlinked = orderAt('order:x1', '2026-05-06T16:57:20Z', 'Lactate', 'unknown', false);
    const uncorroborated = orderAt('order:x2', '2026-05-06T16:57:20Z', 'Lactate');
    const resolved = resolveOrderAuthorship([unlinked, uncorroborated]);
    expect(resolved.map((entry) => entry.authorship)).toEqual(['unknown', 'unknown']);
    expect(resolved[0].actor_role).toBe('unknown');
    const packet = buildEvidencePacket(resolved, opts);
    expect(packet.learnerOrderEventIds).toEqual([]);
    expect(packet.unknownOrderEventIds).toEqual(['order:x1', 'order:x2']);
  });

  it('unknown: an order with another recorded author is never credited to the learner', () => {
    const [entry] = resolveOrderAuthorship([orderAt('order:att', '2026-05-06T16:57:20Z', 'Lactate', 'attending')]);
    expect(entry.authorship).toBe('unknown');
    expect(entry.actor_role).toBe('attending');
  });

  it('unknown: a learner request for a different test does not corroborate this order', () => {
    const request = learnerRequest('chat:req2', '2026-05-06T16:56:28Z', 'Please get a stat BNP.');
    const [order] = resolveOrderAuthorship([request, orderAt('order:ekg', '2026-05-06T16:58:49Z', 'EKG')]).filter((entry) => entry.kind === 'order');
    expect(order.authorship).toBe('unknown');
  });

  it('a baseline PRN request and nurse acknowledgment is closed-loop evidence, never a learner-placed order', () => {
    const entries: EvaluationTimelineEntry[] = [
      learnerRequest('chat:prn-req', '2026-05-06T16:56:28Z', 'Can you give the PRN morphine for his pain?'),
      { id: 'chat:prn-ack', kind: 'message', timestamp: '2026-05-06T16:56:40Z', title: 'Nurse message', body: "I'll give it.", actor_role: 'assistant', channel: 'nurse' },
    ];
    const packet = buildEvidencePacket(resolveOrderAuthorship(entries), opts);
    expect(packet.requestAcknowledgmentPairs).toEqual([{ request_id: 'chat:prn-req', acknowledgment_id: 'chat:prn-ack' }]);
    expect(packet.learnerOrderEventIds).toEqual([]);
  });

  it('Room 203 attempt: all nine assignment-linked orders are inferred from learner requests and confirmation; none observed or unknown', () => {
    const resolved = resolveOrderAuthorship(room203Events.map(manifestEventToEvaluationEntry).filter((entry): entry is EvaluationTimelineEntry => Boolean(entry)));
    const packet = buildEvidencePacket(resolved, opts);
    expect(packet.observedOrderEventIds).toEqual([]);
    expect(packet.inferredOrderEventIds).toEqual(['order:a188ff44', 'order:df5b6a30']);
    expect(packet.unknownOrderEventIds).toEqual([]);
  });

  it('reports a learner order in the Room 203 packet with its authorship breakdown', () => {
    const packet = buildEvidencePacket(resolveOrderAuthorship(room203Entries), opts);
    expect(packet.learnerOrderEventIds).toEqual(['order:a188ff44', 'order:df5b6a30']);
  });
});

