import type { EvaluationTimelineEntry } from './assignment-timeline.ts';
import { buildSourceCoverage, type SourceCoverage } from './feedback-coverage.ts';
import { canonicalizeEvaluation, type EvaluationScoringResponse } from './evaluation-scoring.ts';

// One normalized evidence packet per attempt. The scorer, the commentary
// generator, the debrief, and the reconciliation check all read this packet, so
// they cannot disagree about which learner communication, bedside visit, hint, or
// order was captured.

export const EVIDENCE_PACKET_VERSION = 'althea-evidence-packet-v3-2026-11-19';
export const BEDSIDE_RULE_ALCOHOL_WITHDRAWAL = 'acute_alcohol_withdrawal_info_gathering';
export const BEDSIDE_RULE_VERSION = 'bedside-rule-v1-2026-11-18';

// Bedside visits were recorded only as an assignment status change, which the manifest does
// not read. A bedside visit is now written as a learner action (channel bedside). Attempts
// activated before that write existed have no bedside telemetry, so an absent bedside event
// is "unavailable", not an omission.
// The live value comes from the ALTHEA_BEDSIDE_TELEMETRY_SINCE function secret, set at deploy
// to the LATER of (a) the bedside-write deploy and (b) the Room 506 case-config migration. It is
// read by parseTelemetrySince(). Unset/invalid = null = no bedside penalty for any attempt.
export const BEDSIDE_TELEMETRY_SINCE_ENV = 'ALTHEA_BEDSIDE_TELEMETRY_SINCE';
export const BEDSIDE_TELEMETRY_SINCE: string | null = null;

export const parseTelemetrySince = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

export const bedsideCaptureStatus = (
  activatedAt: string | null | undefined,
  manifestAvailable: boolean,
  telemetrySince: string | null = BEDSIDE_TELEMETRY_SINCE,
): 'complete' | 'unavailable' => {
  if (!manifestAvailable || !parseTelemetrySince(telemetrySince) || !activatedAt) return 'unavailable';
  const activated = Date.parse(activatedAt);
  const since = Date.parse(telemetrySince);
  return Number.isFinite(activated) && Number.isFinite(since) && activated >= since ? 'complete' : 'unavailable';
};

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

// Order authorship. medical_orders.ordered_by is null for most learner-placed orders, so the
// recorded actor alone cannot establish who placed an order. Three states:
//   observed - the recorded direct actor is the learner.
//   inferred - no actor is recorded, the order is linked to THIS assignment (manifest
//              assignment-linked order event), and learner-origin evidence corroborates it:
//              a learner message naming the order shortly before it, or a learner
//              placement confirmation ("I have just placed those orders") shortly after.
//              Matching the room or the timestamp alone is never enough.
//   unknown  - everything else, including other authors, baseline orders, and unlinked
//              orders. Unknown orders earn no learner credit.
const ORDER_TERM_PATTERNS: Array<[RegExp, RegExp]> = [
  [/complete blood count|\bcbc\b/i, /\b(cbc|blood count)\b/i],
  [/comprehensive metabolic|\bcmp\b/i, /\b(cmp|metabolic panel)\b/i],
  [/\babg\b|blood gas/i, /\b(abg|blood gas)\b/i],
  [/x-?ray|radiograph/i, /\b(x-?ray|cxr|chest film|radiograph)\b/i],
  [/lactate/i, /\blactate\b/i],
  [/\bbnp\b|nt-probnp/i, /\bbnp\b/i],
  [/\bekg\b|\becg\b|electrocardiogram/i, /\b(ekg|ecg|electrocardiogram)\b/i],
  [/blood culture/i, /\bblood cultures?\b/i],
  [/troponin/i, /\btroponin\b/i],
];
const LEARNER_PLACEMENT_CONFIRMATION = /\b(?:placed|ordered|entered|put in)\b[^.?!]{0,30}\b(?:orders?|those|these|them|it)\b|\borders?\b[^.?!]{0,20}\b(?:placed|entered|ordered)\b/i;
const ORDER_CORROBORATION_BEFORE_MS = 60 * 60 * 1000;
const ORDER_CORROBORATION_AFTER_MS = 10 * 60 * 1000;

export const orderRequestPatterns = (orderName: string): RegExp[] => {
  const matched = ORDER_TERM_PATTERNS.filter(([name]) => name.test(orderName)).map(([, term]) => term);
  if (matched.length) return matched;
  const longest = orderName.split(/[^A-Za-z]+/).filter((word) => word.length >= 4).sort((a, b) => b.length - a.length)[0];
  return longest ? [new RegExp(`\\b${longest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')] : [];
};

export const resolveOrderAuthorship = (entries: EvaluationTimelineEntry[]): EvaluationTimelineEntry[] => {
  const learnerMessages = entries.filter((entry) => (entry.kind === 'message' || entry.kind === 'consultant-message') && isLearnerRole(entry.actor_role) && entry.timestamp);
  return entries.map((entry) => {
    if (entry.kind !== 'order') return entry;
    const role = (entry.actor_role ?? '').toLowerCase();
    const recordedLearner = isLearnerRole(role);
    const recordedOther = role !== '' && role !== 'unknown';
    if (recordedLearner) {
      return { ...entry, authorship: 'observed' as const, meta: [...(entry.meta ?? []), 'Author: Student (observed: recorded actor is the learner).'] };
    }
    if (recordedOther || !entry.assignment_linked || !entry.timestamp) {
      return { ...entry, authorship: 'unknown' as const, meta: [...(entry.meta ?? []), 'Author: unknown; not credited to the learner.'] };
    }
    const orderMs = Date.parse(entry.timestamp);
    const patterns = orderRequestPatterns(entry.title.replace(/^Order:\s*/i, '') + ' ' + (entry.body ?? ''));
    const request = learnerMessages.find((message) => {
      const ms = Date.parse(message.timestamp as string);
      return ms <= orderMs && orderMs - ms <= ORDER_CORROBORATION_BEFORE_MS && patterns.some((pattern) => pattern.test(message.body ?? ''));
    });
    const confirmation = learnerMessages.find((message) => {
      const ms = Date.parse(message.timestamp as string);
      return ms >= orderMs && ms - orderMs <= ORDER_CORROBORATION_AFTER_MS && LEARNER_PLACEMENT_CONFIRMATION.test(message.body ?? '');
    });
    if (!request && !confirmation) {
      return { ...entry, authorship: 'unknown' as const, meta: [...(entry.meta ?? []), 'Author: unknown; assignment-linked but no learner request or confirmation corroborates it.'] };
    }
    const corroboration = request ? `learner request ${request.id}` : `learner placement confirmation ${confirmation!.id}`;
    return {
      ...entry,
      actor_role: 'student',
      authorship: 'inferred' as const,
      meta: [...(entry.meta ?? []), `Author: Student (inferred from assignment-linked order with no recorded actor; corroborated by ${corroboration}).`],
    };
  });
};

// Back-compat name used by earlier callers: the same three-state resolution.
export const attributeUnrecordedOrderActors = resolveOrderAuthorship;

// Safety deduction support (rubric section C). A level above none needs a specific learner
// action or order from this attempt, cited by event ID, plus the action and rationale. Missed
// or late assessment/escalation is not a safety action; it belongs in its own component.
export const SAFETY_EVIDENCE_RULE = 'rubric C (safety deduction): an observed unsafe learner action or order, cited by linked event ID';
export const safetyActionEventIds = (packet: EvidencePacket): string[] => [...new Set([...packet.learnerOrderEventIds, ...packet.learnerActionEventIds])];

export const enforceSafetyEvidence = <T extends { safety_result: { level: string; action: string | null; rationale: string | null; evidence_event_ids: string[] }; mdm_breakdown: { safety_deduction: { score: number | null; feedback: string; evidence_event_ids: string[] } } }>(
  evaluation: T,
  packet: EvidencePacket,
): { evaluation: T; downgraded: boolean; reason: string | null } => {
  const level = evaluation.safety_result.level;
  if (level !== 'concern' && level !== 'critical') return { evaluation, downgraded: false, reason: null };
  const allowed = new Set(safetyActionEventIds(packet));
  const cited = evaluation.safety_result.evidence_event_ids;
  const outside = cited.filter((id) => !allowed.has(id));
  const hasAction = typeof evaluation.safety_result.action === 'string' && evaluation.safety_result.action.trim().length > 0;
  const hasRationale = typeof evaluation.safety_result.rationale === 'string' && evaluation.safety_result.rationale.trim().length > 0;
  const reason = !cited.length
    ? 'no linked learner action or order event was cited'
    : outside.length
      ? `cited event(s) are not learner actions or orders in this attempt: ${outside.slice(0, 5).join(', ')}`
      : !hasAction ? 'no specific unsafe learner action was named' : !hasRationale ? 'no rationale was given' : null;
  if (!reason) return { evaluation, downgraded: false, reason: null };
  const note = `Safety reduced to none: ${reason}. Severe illness, oxygen support, or a missed assessment or escalation is not by itself a safety concern (${SAFETY_EVIDENCE_RULE}).`;
  return {
    evaluation: {
      ...evaluation,
      safety_result: { ...evaluation.safety_result, level: 'none', action: 'No unsafe learner action or order is supported by linked evidence.', rationale: note, evidence_event_ids: [] },
      mdm_breakdown: { ...evaluation.mdm_breakdown, safety_deduction: { ...evaluation.mdm_breakdown.safety_deduction, score: 0, feedback: note, evidence_event_ids: [] } },
    },
    downgraded: true,
    reason,
  };
};

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
  // Learner-placed orders = observed + inferred. Unknown-author orders are listed but never credited.
  learnerOrderEventIds: string[];
  observedOrderEventIds: string[];
  inferredOrderEventIds: string[];
  unknownOrderEventIds: string[];
  // Learner actions that are not bedside visits or hint openings (for safety evidence).
  learnerActionEventIds: string[];
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
  options: { manifestAvailable: boolean; progressNotePresent: boolean; caseKeyGoalCount: number; activatedAt?: string | null; telemetrySince?: string | null },
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
    learnerOrderEventIds: ids((entry) => entry.kind === 'order' && (entry.authorship === 'observed' || entry.authorship === 'inferred')),
    observedOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship === 'observed'),
    inferredOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship === 'inferred'),
    unknownOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship !== 'observed' && entry.authorship !== 'inferred'),
    learnerActionEventIds: ids((entry) => entry.kind === 'learner-action' && isLearnerRole(entry.actor_role) && entry.channel !== 'bedside'),
    resultEventIds: ids((entry) => entry.kind === 'labs' || entry.kind === 'vital' || entry.kind === 'imaging'),
    requestAcknowledgmentPairs: pairRequestAcknowledgments(entries),
    finalNoteEventId: entries.find((entry) => entry.kind === 'progress-note')?.id ?? null,
    baselineMedicationsAndOrders: 'unavailable',
    captureStatus: { coverage, bedside: bedsideCaptureStatus(options.activatedAt, options.manifestAvailable, options.telemetrySince) },
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
  `Learner-placed orders credited: ${packet.learnerOrderEventIds.length} (observed ${packet.observedOrderEventIds.length}, inferred ${packet.inferredOrderEventIds.length}); orders with unknown author, not credited: ${packet.unknownOrderEventIds.length}. Inferred orders are assignment-linked and corroborated by learner messages; they are not observed actions.`,
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
