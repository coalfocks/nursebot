import type { EvaluationTimelineEntry } from './assignment-timeline.ts';
import { buildSourceCoverage, type SourceCoverage } from './feedback-coverage.ts';

// One normalized evidence packet per attempt. The scorer, the commentary
// generator, the debrief, and the reconciliation check all read this packet, so
// they cannot disagree about which learner communication, bedside visit, hint, or
// order was captured.

export const EVIDENCE_PACKET_VERSION = 'althea-evidence-packet-v3-2026-11-19';

const isLearnerRole = (role: string | null | undefined) => ['student', 'user', 'learner'].includes((role ?? '').toLowerCase());
const isNurseRole = (role: string | null | undefined) => ['assistant', 'nurse'].includes((role ?? '').toLowerCase());

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
  // Learner actions that are not bedside visits or hint openings.
  learnerActionEventIds: string[];
  resultEventIds: string[];
  requestAcknowledgmentPairs: RequestAcknowledgmentPair[];
  finalNoteEventId: string | null;
  // The manifest does not carry the historical baseline medication/order list yet.
  // Reported as unavailable rather than filled from today's chart.
  baselineMedicationsAndOrders: 'unavailable';
  captureStatus: { coverage: SourceCoverage };
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
    learnerOrderEventIds: ids((entry) => entry.kind === 'order' && (entry.authorship === 'observed' || entry.authorship === 'inferred')),
    observedOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship === 'observed'),
    inferredOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship === 'inferred'),
    unknownOrderEventIds: ids((entry) => entry.kind === 'order' && entry.authorship !== 'observed' && entry.authorship !== 'inferred'),
    learnerActionEventIds: ids((entry) => entry.kind === 'learner-action' && isLearnerRole(entry.actor_role) && entry.channel !== 'bedside'),
    resultEventIds: ids((entry) => entry.kind === 'labs' || entry.kind === 'vital' || entry.kind === 'imaging'),
    requestAcknowledgmentPairs: pairRequestAcknowledgments(entries),
    finalNoteEventId: entries.find((entry) => entry.kind === 'progress-note')?.id ?? null,
    baselineMedicationsAndOrders: 'unavailable',
    captureStatus: { coverage },
  };
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
