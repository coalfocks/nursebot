import type { EvaluationTimelineEntry } from './assignment-timeline.ts';
import { buildSourceCoverage, type SourceCoverage } from './feedback-coverage.ts';
import { canonicalizeEvaluation, type EvaluationScoringResponse } from './evaluation-scoring.ts';

// One normalized evidence packet per attempt. The scorer, the commentary
// generator, the debrief, and the reconciliation check all read this packet, so
// they cannot disagree about which learner communication, bedside visit, hint, or
// order was captured.

export const EVIDENCE_PACKET_VERSION = 'althea-evidence-packet-v2-2026-11-19';
export const BEDSIDE_RULE_ALCOHOL_WITHDRAWAL = 'acute_alcohol_withdrawal_info_gathering';
export const BEDSIDE_RULE_VERSION = 'bedside-rule-v1-2026-11-18';

export type BedsideExpectation = 'required' | 'optional' | 'not_applicable';

export type BedsideExpectationConfig = {
  expectation: BedsideExpectation | null;
  rule: string | null;
  source: 'case_evaluation' | 'room_bedside_requirement' | 'unconfigured';
  rule_version: string;
};

const isLearnerRole = (role: string | null | undefined) => ['student', 'user', 'learner'].includes((role ?? '').toLowerCase());
const isNurseRole = (role: string | null | undefined) => ['assistant', 'nurse'].includes((role ?? '').toLowerCase());

const readEvaluation = (room: Record<string, unknown>): Record<string, unknown> => {
  try {
    const parsed = typeof room.emr_context === 'string' ? JSON.parse(room.emr_context) : room.emr_context;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const evaluation = (parsed as Record<string, unknown>).evaluation;
    return evaluation && typeof evaluation === 'object' && !Array.isArray(evaluation) ? evaluation as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

// Per-case bedside expectation. An explicit case-evaluation value wins. Otherwise
// the existing room/case bedside_requirement column is mapped: yes -> required,
// situational -> optional, no -> not applicable. The specialty name is never used.
export const resolveBedsideExpectation = (room: Record<string, unknown>): BedsideExpectationConfig => {
  const evaluation = readEvaluation(room);
  const explicit = evaluation.bedsideExpectation;
  const rule = evaluation.bedsideRule === BEDSIDE_RULE_ALCOHOL_WITHDRAWAL ? BEDSIDE_RULE_ALCOHOL_WITHDRAWAL : null;
  if (explicit === 'required' || explicit === 'optional' || explicit === 'not_applicable') {
    return { expectation: explicit, rule, source: 'case_evaluation', rule_version: BEDSIDE_RULE_VERSION };
  }
  const column = typeof room.bedside_requirement === 'string' ? room.bedside_requirement.toLowerCase() : null;
  const mapped: BedsideExpectation | null = column === 'yes' ? 'required' : column === 'situational' ? 'optional' : column === 'no' ? 'not_applicable' : null;
  return mapped
    ? { expectation: mapped, rule, source: 'room_bedside_requirement', rule_version: BEDSIDE_RULE_VERSION }
    : { expectation: null, rule, source: 'unconfigured', rule_version: BEDSIDE_RULE_VERSION };
};

// Whole-attempt window for bedside and hint capture: from activation through completion.
// Bedside-first events before the first nurse page are part of the attempt.
export const selectAttemptEntries = (
  entries: EvaluationTimelineEntry[],
  activatedAt: string | null | undefined,
  completedAt: string | null | undefined,
): EvaluationTimelineEntry[] => {
  const startMs = activatedAt ? Date.parse(activatedAt) : Number.NEGATIVE_INFINITY;
  const endMs = completedAt ? Date.parse(completedAt) : Number.POSITIVE_INFINITY;
  return entries.filter((entry) => {
    const ms = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
    return Number.isFinite(ms) && ms >= (Number.isFinite(startMs) ? startMs : Number.NEGATIVE_INFINITY) && ms <= (Number.isFinite(endMs) ? endMs : Number.POSITIVE_INFINITY);
  });
};

// The order manifest records the actor from medical_orders.ordered_by, which is null for
// most learner-placed orders. Without an actor the packet reports zero learner orders while
// the chat says the learner placed them. Within the scored window, an order on this
// assignment with no recorded actor is attributed to the learner and labeled as inferred.
// Baseline orders are not attached to the attempt and are excluded upstream.
export const attributeUnrecordedOrderActors = (entries: EvaluationTimelineEntry[]): EvaluationTimelineEntry[] => entries.map((entry) => {
  const role = (entry.actor_role ?? '').toLowerCase();
  if (entry.kind !== 'order' || (role !== '' && role !== 'unknown')) return entry;
  return {
    ...entry,
    actor_role: 'student',
    meta: [...(entry.meta ?? []), 'Actor not recorded on the order; attributed to the learner because it was placed on this assignment in the scored window (inferred).'],
  };
});

export type EvidencePacket = {
  version: string;
  sourceEventIds: string[];
  // Learner, nurse, patient, and consultant messages, with structured actor roles.
  communicationEventIds: string[];
  learnerCommunicationEventIds: string[];
  nurseReplyEventIds: string[];
  // Learner-authored events that can close a loop: nurse-chat requests/reports,
  // consultant requests/messages, and bedside actions. Closed-loop evidence is
  // drawn only from this list, so nurse-chat requests can be linked.
  closedLoopEventIds: string[];
  consultEventIds: string[];
  bedsideEventIds: string[];
  hintEventIds: string[];
  learnerOrderEventIds: string[];
  resultEventIds: string[];
  requestAcknowledgmentPairs: RequestAcknowledgmentPair[];
  finalNoteEventId: string | null;
  // The manifest does not carry the historical baseline medication/order list yet.
  // Reported as unavailable rather than filled from today's chart.
  baselineMedicationsAndOrders: 'unavailable';
  captureStatus: { coverage: SourceCoverage; bedside: 'complete' | 'unavailable' };
};

// A learner request (for example a PRN request or a stat-order request) paired with
// the nurse reply that acknowledges it. The pair is closed-loop evidence. It does not
// by itself prove an order exists or that the treatment was given: a baseline PRN is
// authorization only when the baseline is available, and the simulator records no MAR.
export type RequestAcknowledgmentPair = { request_id: string; acknowledgment_id: string };

const REQUEST_PATTERN = /\b(?:please|can you|could you|would you|can we|we need|i need|i want you to|order|give|administer|start|hang|push|increase|titrate|send|notify|page|call|prn|as needed)\b/i;
const ACKNOWLEDGMENT_PATTERN = /\b(?:i['’]?ll give|i will give|giving (?:it|him|her|them|the)|i['’]?ll (?:give|start|order|get|push|hang|administer|notify|page|call|proceed|check|do|update|monitor|prepare)|i will (?:give|start|order|get|push|hang|administer|notify|page|call|proceed|check|do|update|monitor|prepare)|will do|on it|i['’]?m going to (?:give|start|order|notify|page|call|proceed))\b/i;
// The acknowledgment must answer the request promptly, before the learner speaks again.
const ACKNOWLEDGMENT_WINDOW_MS = 10 * 60 * 1000;

// Pairs each learner request with the next nurse reply that acknowledges it. Learner
// messages between the request and the reply end the search, so a later acknowledgment
// is not attributed to an earlier request.
export const pairRequestAcknowledgments = (entries: EvaluationTimelineEntry[]): RequestAcknowledgmentPair[] => {
  const ordered = [...entries]
    .filter((entry) => (entry.kind === 'message' || entry.kind === 'consultant-message') && entry.timestamp)
    .sort((a, b) => Date.parse(a.timestamp as string) - Date.parse(b.timestamp as string) || (a.sequence ?? 0) - (b.sequence ?? 0));
  const pairs: RequestAcknowledgmentPair[] = [];
  ordered.forEach((request, index) => {
    if (!isLearnerRole(request.actor_role) || !REQUEST_PATTERN.test(request.body ?? '')) return;
    const requestMs = Date.parse(request.timestamp as string);
    for (let next = index + 1; next < ordered.length; next += 1) {
      const candidate = ordered[next];
      const candidateMs = Date.parse(candidate.timestamp as string);
      if (candidateMs - requestMs > ACKNOWLEDGMENT_WINDOW_MS) break;
      if (isLearnerRole(candidate.actor_role)) break;
      if (!isNurseRole(candidate.actor_role)) continue;
      if (ACKNOWLEDGMENT_PATTERN.test(candidate.body ?? '')) {
        pairs.push({ request_id: request.id, acknowledgment_id: candidate.id });
      }
      break;
    }
  });
  return pairs;
};

export const buildEvidencePacket = (
  entries: EvaluationTimelineEntry[],
  options: { manifestAvailable: boolean; progressNotePresent: boolean; caseKeyGoalCount: number },
): EvidencePacket => {
  const ids = (predicate: (entry: EvaluationTimelineEntry) => boolean) => entries.filter(predicate).map((entry) => entry.id);
  const coverage = buildSourceCoverage(entries, options);
  return {
    version: EVIDENCE_PACKET_VERSION,
    sourceEventIds: entries.map((entry) => entry.id),
    communicationEventIds: ids((entry) => entry.kind === 'message' || entry.kind === 'consultant-message'),
    learnerCommunicationEventIds: ids((entry) => (entry.kind === 'message' || entry.kind === 'consultant-message') && isLearnerRole(entry.actor_role)),
    nurseReplyEventIds: ids((entry) => entry.kind === 'message' && isNurseRole(entry.actor_role)),
    closedLoopEventIds: ids((entry) => (entry.kind === 'message' || entry.kind === 'consultant-message' || entry.kind === 'learner-action') && isLearnerRole(entry.actor_role)),
    consultEventIds: ids((entry) => entry.kind === 'consultant-message' && isLearnerRole(entry.actor_role)),
    bedsideEventIds: ids((entry) => entry.kind === 'learner-action' && entry.channel === 'bedside'),
    // Opening a hint is visible and time-stamped, but it is not a bedside visit,
    // a learner message, or a learner action.
    hintEventIds: ids((entry) => entry.kind === 'hint'),
    learnerOrderEventIds: ids((entry) => entry.kind === 'order' && isLearnerRole(entry.actor_role)),
    resultEventIds: ids((entry) => entry.kind === 'labs' || entry.kind === 'vital' || entry.kind === 'imaging'),
    requestAcknowledgmentPairs: pairRequestAcknowledgments(entries),
    finalNoteEventId: entries.find((entry) => entry.kind === 'progress-note')?.id ?? null,
    baselineMedicationsAndOrders: 'unavailable',
    captureStatus: { coverage, bedside: options.manifestAvailable ? 'complete' : 'unavailable' },
  };
};

// Human-readable header for the scorer and commentary prompts. It states the exact
// captured counts so the model cannot describe a channel as empty while it holds events.
// Bedside and hint counts come from the whole-attempt packet, so bedside-first events
// before the first nurse page are reported.
export const renderPacketSummaryForPrompt = (packet: EvidencePacket, bedside: EvidencePacket = packet) => [
  `EVIDENCE PACKET ${packet.version}`,
  `Baseline medications and active orders: ${packet.baselineMedicationsAndOrders} (not in this packet; do not infer them).`,
  `Learner communication events captured: ${packet.learnerCommunicationEventIds.length} (${packet.learnerCommunicationEventIds.join(', ') || 'none'}).`,
  `Nurse replies captured: ${packet.nurseReplyEventIds.length}.`,
  `Bedside visits captured: ${bedside.bedsideEventIds.length} (${bedside.bedsideEventIds.join(', ') || 'none'}); bedside capture is ${bedside.captureStatus.bedside}.`,
  `Hint openings captured (not learner actions, not bedside visits): ${bedside.hintEventIds.length}.`,
  `Learner-placed orders captured: ${packet.learnerOrderEventIds.length}.`,
  `Learner consultant requests/messages captured: ${packet.consultEventIds.length}.`,
  `Learner requests acknowledged by the nurse: ${packet.requestAcknowledgmentPairs.length} pair(s) (${packet.requestAcknowledgmentPairs.map((pair) => `${pair.request_id} -> ${pair.acknowledgment_id}`).join('; ') || 'none'}).`,
  `Final note event: ${packet.finalNoteEventId ?? 'none'}.`,
].join('\n');

export type BedsideRuleResult = { applied: boolean; reason: string; before: number | null; after: number | null };

// The alcohol-withdrawal rule: one point off information gathering, floor zero,
// applied once, only when the case requires bedside evaluation, capture is complete,
// and no bedside visit was recorded. Other cases get no automatic deduction.
export const applyBedsideInformationRule = (
  infoScore: number | null,
  packet: EvidencePacket,
  config: BedsideExpectationConfig,
): BedsideRuleResult => {
  const base = { before: infoScore, after: infoScore };
  if (config.rule !== BEDSIDE_RULE_ALCOHOL_WITHDRAWAL) return { applied: false, reason: 'No bedside-information rule configured for this case.', ...base };
  if (config.expectation !== 'required') return { applied: false, reason: 'Bedside evaluation is not required for this case.', ...base };
  if (packet.captureStatus.bedside !== 'complete') return { applied: false, reason: 'Bedside capture incomplete; no bedside deduction is made.', ...base };
  if (packet.bedsideEventIds.length > 0) return { applied: false, reason: 'A bedside visit is recorded; no deduction.', ...base };
  if (infoScore == null) return { applied: false, reason: 'Information-gathering score is unassessable; no deduction is made.', ...base };
  if (infoScore <= 0) return { applied: false, reason: 'Information-gathering score is already at the floor.', ...base };
  return { applied: true, reason: 'Required bedside evaluation not recorded; information gathering reduced by one point (floor 0).', before: infoScore, after: infoScore - 1 };
};

// Applies the bedside rule after the room leniency step, then recomputes totals.
export const applyBedsideRuleToEvaluation = (
  evaluation: EvaluationScoringResponse,
  packet: EvidencePacket,
  config: BedsideExpectationConfig,
): { evaluation: EvaluationScoringResponse; result: BedsideRuleResult } => {
  const result = applyBedsideInformationRule(evaluation.communication_breakdown.focused_information_gathering.score, packet, config);
  if (!result.applied) return { evaluation, result };
  const focused = { ...evaluation.communication_breakdown.focused_information_gathering, score: result.after };
  const updated = canonicalizeEvaluation({
    ...evaluation,
    communication_breakdown: { ...evaluation.communication_breakdown, focused_information_gathering: focused },
  });
  return { evaluation: updated, result };
};

const CONTRADICTORY_COMMUNICATION = /\b(?:no|zero|not any|none)\b[^.;]{0,60}\b(?:communication|messages?|questions?|team (?:instructions?|requests?|updates?)|learner (?:questions?|messages?|communication))\b[^.;]{0,40}\b(?:captured|recorded|observed|documented|present|available)\b|\b(?:communication|messages?|questions?|team (?:instructions?|requests?))\b[^.;]{0,40}\b(?:was|were|is|are) not (?:captured|recorded|observed|documented)\b/i;
// "No orders were captured" / "no consult placed" while the packet holds learner orders or consults.
const CONTRADICTORY_ORDERS = /\b(?:no|zero|none|not any)\s+(?:learner[- ](?:placed|authored)\s+|learner\s+)?(?:orders?|consults?|consultations?|consult requests?|consultant (?:requests?|messages?))\b[^.;]{0,30}\b(?:captured|recorded|observed|documented|placed|present|available)\b/i;
const CONTRADICTORY_BEDSIDE = /\b(?:did not|didn'?t|never|no|not)\b[^.;]{0,30}\b(?:go|went|visit|visited|attend|attended|reach|reached)\b[^.;]{0,25}\bbedside\b/i;

// Reconciliation gate. Returns error strings; any entry means the run must not save.
export const reconcileEvidence = (input: {
  packet: EvidencePacket;
  bedsideEventIds?: string[];
  texts: string[];
  componentEvidenceIds: string[];
  commentEvidenceIds: string[];
}): string[] => {
  const bedsideEventIds = input.bedsideEventIds ?? input.packet.bedsideEventIds;
  const errors: string[] = [];
  const sourceIds = new Set(input.packet.sourceEventIds);
  const badComponent = input.componentEvidenceIds.filter((id) => !sourceIds.has(id));
  if (badComponent.length) errors.push(`component evidence references events outside the packet: ${badComponent.slice(0, 5).join(', ')}`);
  const badComment = input.commentEvidenceIds.filter((id) => !sourceIds.has(id));
  if (badComment.length) errors.push(`commentary references events outside the packet: ${badComment.slice(0, 5).join(', ')}`);
  const communicationCount = input.packet.learnerCommunicationEventIds.length;
  if (communicationCount > 0 && input.texts.some((text) => CONTRADICTORY_COMMUNICATION.test(text))) {
    errors.push(`contradiction: text says no communication was captured, but the packet holds ${communicationCount} learner communication event(s)`);
  }
  const orderCount = input.packet.learnerOrderEventIds.length;
  const consultCount = input.packet.consultEventIds.length;
  if (orderCount > 0 && input.texts.some((text) => CONTRADICTORY_ORDERS.test(text) && /\border/i.test(text))) {
    errors.push(`contradiction: text says no order was captured, but the packet holds ${orderCount} learner-placed order(s)`);
  }
  if (consultCount > 0 && input.texts.some((text) => CONTRADICTORY_ORDERS.test(text) && /\bconsult/i.test(text))) {
    errors.push(`contradiction: text says no consult was captured, but the packet holds ${consultCount} learner consult event(s)`);
  }
  if (bedsideEventIds.length > 0 && input.texts.some((text) => CONTRADICTORY_BEDSIDE.test(text))) {
    errors.push('contradiction: text says the learner did not visit the bedside, but a bedside visit is recorded');
  }
  return errors;
};

// Closed-loop evidence for a scored closed-loop component. The model's cited IDs are kept
// only when they are learner closed-loop candidates. A positive score with no usable link
// falls back to the packet's deterministic request/acknowledgment pairs; if none exist the
// score is unsupported and the run must not save.
export const resolveClosedLoopEvidence = (input: {
  requestedIds: unknown;
  score: number | null;
  candidateIds: string[];
  pairs: RequestAcknowledgmentPair[];
  sourceEventIds: string[];
}): { evidenceIds: string[]; error: string | null } => {
  const candidates = new Set(input.candidateIds);
  const requested = Array.isArray(input.requestedIds)
    ? input.requestedIds.filter((id): id is string => typeof id === 'string' && candidates.has(id))
    : [];
  if (requested.length) return { evidenceIds: requested, error: null };
  if (input.score == null) return { evidenceIds: [], error: null };
  if (input.score <= 0) return { evidenceIds: input.candidateIds, error: null };
  const sources = new Set(input.sourceEventIds);
  const paired = [...new Set(input.pairs.flatMap((pair) => [pair.request_id, pair.acknowledgment_id]))].filter((id) => sources.has(id));
  if (paired.length) return { evidenceIds: paired, error: null };
  return { evidenceIds: [], error: `closed-loop communication scored ${input.score} with no linked learner request or acknowledgment in the packet` };
};
