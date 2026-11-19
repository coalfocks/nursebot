import type { EvaluationTimelineEntry } from './assignment-timeline.ts';
import { buildSourceCoverage, type SourceCoverage } from './feedback-coverage.ts';
import { canonicalizeEvaluation, type EvaluationScoringResponse } from './evaluation-scoring.ts';

// One normalized evidence packet per attempt. The scorer, the commentary
// generator, the debrief, and the reconciliation check all read this packet, so
// they cannot disagree about which learner communication, bedside visit, hint, or
// order was captured.

export const EVIDENCE_PACKET_VERSION = 'althea-evidence-packet-v1-2026-11-18';
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

export type EvidencePacket = {
  version: string;
  sourceEventIds: string[];
  // Learner, nurse, patient, and consultant messages, with structured actor roles.
  communicationEventIds: string[];
  learnerCommunicationEventIds: string[];
  nurseReplyEventIds: string[];
  bedsideEventIds: string[];
  hintEventIds: string[];
  learnerOrderEventIds: string[];
  resultEventIds: string[];
  finalNoteEventId: string | null;
  // The manifest does not carry the historical baseline medication/order list yet.
  // Reported as unavailable rather than filled from today's chart.
  baselineMedicationsAndOrders: 'unavailable';
  captureStatus: { coverage: SourceCoverage; bedside: 'complete' | 'unavailable' };
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
    bedsideEventIds: ids((entry) => entry.kind === 'learner-action' && entry.channel === 'bedside'),
    // Opening a hint is visible and time-stamped, but it is not a bedside visit,
    // a learner message, or a learner action.
    hintEventIds: ids((entry) => entry.kind === 'hint'),
    learnerOrderEventIds: ids((entry) => entry.kind === 'order' && isLearnerRole(entry.actor_role)),
    resultEventIds: ids((entry) => entry.kind === 'labs' || entry.kind === 'vital' || entry.kind === 'imaging'),
    finalNoteEventId: entries.find((entry) => entry.kind === 'progress-note')?.id ?? null,
    baselineMedicationsAndOrders: 'unavailable',
    captureStatus: { coverage, bedside: options.manifestAvailable ? 'complete' : 'unavailable' },
  };
};

// Human-readable header for the scorer and commentary prompts. It states the exact
// captured counts so the model cannot describe a channel as empty while it holds events.
export const renderPacketSummaryForPrompt = (packet: EvidencePacket) => [
  `EVIDENCE PACKET ${packet.version}`,
  `Baseline medications and active orders: ${packet.baselineMedicationsAndOrders} (not in this packet; do not infer them).`,
  `Learner communication events captured: ${packet.learnerCommunicationEventIds.length} (${packet.learnerCommunicationEventIds.join(', ') || 'none'}).`,
  `Nurse replies captured: ${packet.nurseReplyEventIds.length}.`,
  `Bedside visits captured: ${packet.bedsideEventIds.length} (${packet.bedsideEventIds.join(', ') || 'none'}); bedside capture is ${packet.captureStatus.bedside}.`,
  `Hint openings captured (not learner actions, not bedside visits): ${packet.hintEventIds.length}.`,
  `Learner-placed orders captured: ${packet.learnerOrderEventIds.length}.`,
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

const CONTRADICTORY_COMMUNICATION = /\b(?:no|zero|not any|none)\b[^.;]{0,60}\b(?:communication|messages?|questions?|team (?:instructions?|requests?|updates?)|learner (?:questions?|messages?|communication))\b[^.;]{0,40}\b(?:captured|recorded|observed|documented|present|available)\b/i;
const CONTRADICTORY_BEDSIDE = /\b(?:did not|didn'?t|never|no|not)\b[^.;]{0,30}\b(?:go|went|visit|visited|attend|attended|reach|reached)\b[^.;]{0,25}\bbedside\b/i;

// Reconciliation gate. Returns error strings; any entry means the run must not save.
export const reconcileEvidence = (input: {
  packet: EvidencePacket;
  texts: string[];
  componentEvidenceIds: string[];
  commentEvidenceIds: string[];
}): string[] => {
  const errors: string[] = [];
  const sourceIds = new Set(input.packet.sourceEventIds);
  const badComponent = input.componentEvidenceIds.filter((id) => !sourceIds.has(id));
  if (badComponent.length) errors.push(`component evidence references events outside the packet: ${badComponent.slice(0, 5).join(', ')}`);
  const badComment = input.commentEvidenceIds.filter((id) => !sourceIds.has(id));
  if (badComment.length) errors.push(`commentary references events outside the packet: ${badComment.slice(0, 5).join(', ')}`);
  if (input.packet.learnerCommunicationEventIds.length > 0 && input.texts.some((text) => CONTRADICTORY_COMMUNICATION.test(text))) {
    errors.push(`contradiction: text says no communication was captured, but the packet holds ${input.packet.learnerCommunicationEventIds.length} learner communication event(s)`);
  }
  if (input.packet.bedsideEventIds.length > 0 && input.texts.some((text) => CONTRADICTORY_BEDSIDE.test(text))) {
    errors.push('contradiction: text says the learner did not visit the bedside, but a bedside visit is recorded');
  }
  return errors;
};
