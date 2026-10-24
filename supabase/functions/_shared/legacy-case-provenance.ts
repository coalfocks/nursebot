export type LegacyArchiveRow = Record<string, unknown>;

export type LegacyCaseIdentity = {
  patientId: string | null;
  schoolId: string | null;
  roomId: number | null;
  pinnedCaseVersion: string | null;
  identityProvenance: 'assignment' | 'joined-room' | 'missing';
};

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const identityMatches = (row: LegacyArchiveRow, identity: LegacyCaseIdentity) => {
  const patientId = text(row.patient_id);
  const schoolId = text(row.school_id);
  const roomId = number(row.room_id);
  return (!identity.patientId || patientId === identity.patientId)
    && (!identity.schoolId || !schoolId || schoolId === identity.schoolId)
    && (!identity.roomId || roomId === identity.roomId);
};

const completionEligible = (row: LegacyArchiveRow, cutoffMs: number, pinnedCaseVersion: string | null) => {
  const recordedAt = text(row.created_at);
  if (!recordedAt || Number.isNaN(new Date(recordedAt).getTime()) || new Date(recordedAt).getTime() > cutoffMs) return false;
  return !pinnedCaseVersion || row.case_version === pinnedCaseVersion;
};

export const resolveLegacyCaseProvenance = ({
  assignmentRows,
  authoredRows,
  identity,
  completedAt,
  hasFullScenarioBaseline,
}: {
  assignmentRows: LegacyArchiveRow[];
  authoredRows: LegacyArchiveRow[];
  identity: LegacyCaseIdentity;
  completedAt: string;
  hasFullScenarioBaseline: boolean;
}) => {
  const cutoffMs = new Date(completedAt).getTime();
  const flags: string[] = [];
  const references: LegacyArchiveRow[] = [];
  const identityExcluded: LegacyArchiveRow[] = [];
  const identityUnresolved = identity.identityProvenance !== 'assignment';
  if (identityUnresolved) flags.push('historical_assignment_identity_unresolved');
  const usableAssignmentRows = assignmentRows.filter((row) => {
    if (identityMatches(row, identity)) return true;
    identityExcluded.push({ ...row, exclusion_reason: 'patient_school_or_room_mismatch' });
    return false;
  });
  const usableAuthoredRows = authoredRows.filter((row) => {
    if (identityMatches(row, identity)) return true;
    identityExcluded.push({ ...row, exclusion_reason: 'patient_school_or_room_mismatch' });
    return false;
  });
  if (identityExcluded.length) flags.push('archive_identity_mismatch_excluded');

  const eligible = (row: LegacyArchiveRow) => completionEligible(row, cutoffMs, identity.pinnedCaseVersion);
  const pinned = usableAssignmentRows.filter(eligible)[0] ?? null;
  // Inspect the newest completion-time authored version even when a pinned
  // assignment version exists; otherwise a conflicting authored v2 would be
  // silently filtered out and the lineage problem would disappear.
  const authored = usableAuthoredRows.filter((row) => completionEligible(row, cutoffMs, null))[0] ?? null;
  const authoredConflict = Boolean(pinned && authored && pinned.case_version !== authored.case_version);
  const explicitVersionMismatch = Boolean(identity.pinnedCaseVersion && authored && authored.case_version !== identity.pinnedCaseVersion && !pinned);
  if (authoredConflict) flags.push('case_lineage_conflict_pinned_assignment_over_authored');
  if (explicitVersionMismatch) flags.push('case_version_source_mismatch_pinned_assignment_archive_missing');

  for (const row of assignmentRows) references.push({
    source_table: 'mar_assignment_baseline_versions',
    source_key: `${String(row.assignment_id)}:${String(row.case_version)}`,
    case_version: row.case_version ?? null,
    patient_id: row.patient_id ?? null,
    school_id: row.school_id ?? null,
    room_id: row.room_id ?? null,
    recorded_at: row.created_at ?? null,
    available_at: row.created_at ?? null,
    source_scope: 'assignment-pinned',
    complete_case_snapshot: false,
    usable_at_completion: row === pinned && !identityUnresolved,
    exclusion_reason: row === pinned ? identityUnresolved ? 'historical_assignment_identity_unresolved' : null : identityMatches(row, identity) ? 'not_selected_pinned_version' : 'patient_school_or_room_mismatch',
  });
  for (const row of authoredRows) references.push({
    source_table: 'mar_authored_case_versions',
    source_key: `${String(row.room_id)}:${String(row.case_version)}`,
    case_version: row.case_version ?? null,
    patient_id: row.patient_id ?? null,
    school_id: row.school_id ?? null,
    room_id: row.room_id ?? null,
    recorded_at: row.created_at ?? null,
    available_at: row.created_at ?? null,
    source_scope: 'room-authored',
    complete_case_snapshot: false,
    usable_at_completion: row === authored && !pinned && !explicitVersionMismatch && !identityUnresolved,
    exclusion_reason: row === authored && !pinned && !explicitVersionMismatch ? identityUnresolved ? 'historical_assignment_identity_unresolved' : null : identityMatches(row, identity) ? (explicitVersionMismatch ? 'pinned_assignment_version_not_recovered' : pinned ? 'pinned_assignment_version_takes_precedence' : 'not_selected_completion_version') : 'patient_school_or_room_mismatch',
  });

  if (assignmentRows.length && !pinned) flags.push('assignment_case_version_missing_at_completion');
  if (authoredRows.length && !authored) flags.push('authored_case_version_missing_at_completion');
  const selected = pinned && !identityUnresolved ? pinned : explicitVersionMismatch || authoredConflict || identityUnresolved ? null : authored;
  const resolvedCaseVersion = selected?.case_version ?? (identity.pinnedCaseVersion && !explicitVersionMismatch && !identityUnresolved ? identity.pinnedCaseVersion : null);
  if (!resolvedCaseVersion) flags.push('case_version_unavailable');
  if (!hasFullScenarioBaseline) {
    flags.push('historical_full_case_source_missing');
    if (selected) flags.push('mar_archive_partial_only_orders_events_not_full_chart');
  }
  if (authoredConflict && !pinned) flags.push('case_lineage_unresolved');

  return {
    resolved_case_version: resolvedCaseVersion,
    selected_source: hasFullScenarioBaseline ? 'student_room_assignments.scenario_baseline' : selected ? (pinned ? 'mar_assignment_baseline_versions_partial' : 'mar_authored_case_versions_partial') : null,
    full_case_source_available: hasFullScenarioBaseline,
    resolved_case_version_verified: Boolean(selected && (!identity.pinnedCaseVersion || selected.case_version === identity.pinnedCaseVersion)),
    archive_content_scope: selected && !hasFullScenarioBaseline ? 'orders_and_events_only' : hasFullScenarioBaseline ? 'full_assignment_scenario_baseline' : null,
    assignment_baseline_version: pinned ? { ...pinned, usable_at_completion: Boolean(!identityUnresolved) } : null,
    authored_case_version: authored ? { ...authored, usable_at_completion: Boolean(!pinned && !explicitVersionMismatch && !identityUnresolved) } : null,
    references,
    identity_excluded_references: identityExcluded,
    missing_history_flags: flags,
  };
};

const parseTime = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null;

export const classifyHistoricalNoteCandidates = (rows: LegacyArchiveRow[], completedAt: string, expected: { assignmentId?: string | null; patientId?: string | null; schoolId?: string | null } = {}) => {
  const cutoff = parseTime(completedAt);
  const candidates = rows.map((row) => {
    const createdAt = parseTime(row.created_at);
    const updatedAt = parseTime(row.updated_at);
    const eventAt = parseTime(row.timestamp ?? row.event_at);
    const deletedAt = parseTime(row.deleted_at);
    const content = row.content;
    const contentPresent = typeof content === 'string' ? content.trim().length > 0 : Boolean(content && typeof content === 'object');
    const gaps: string[] = [];
    if (expected.assignmentId && row.assignment_id !== expected.assignmentId) gaps.push('assignment_identity_mismatch');
    if (expected.patientId && row.patient_id !== expected.patientId) gaps.push('patient_identity_mismatch');
    if (expected.schoolId && row.school_id !== expected.schoolId) gaps.push('school_identity_mismatch');
    if (row.override_scope !== 'assignment') gaps.push('assignment_scope_unverified');
    if (cutoff === null) gaps.push('completion_cutoff_invalid');
    if (createdAt === null) gaps.push('created_at_missing_or_invalid');
    else if (cutoff !== null && createdAt > cutoff) gaps.push('created_after_completion');
    if (eventAt !== null && cutoff !== null && eventAt > cutoff) gaps.push('event_after_completion');
    if (updatedAt !== null && cutoff !== null && updatedAt > cutoff) gaps.push('updated_after_completion');
    if (deletedAt !== null && cutoff !== null && deletedAt <= cutoff) gaps.push('deleted_before_or_at_completion');
    if (!contentPresent) gaps.push('historical_content_unavailable');
    return {
      source_id: row.id ?? null,
      source_table: row.source_table ?? 'clinical_notes',
      assignment_id: row.assignment_id ?? null,
      record_version: row.record_version ?? null,
      created_at: row.created_at ?? null,
      event_at: row.timestamp ?? row.event_at ?? null,
      updated_at: row.updated_at ?? null,
      deleted_at: row.deleted_at ?? null,
      content_present: contentPresent,
      verified: gaps.length === 0,
      verification_gaps: gaps,
    };
  });
  return {
    candidates,
    verified: candidates.filter((candidate) => candidate.verified),
    verification_gaps: [...new Set(candidates.flatMap((candidate) => candidate.verification_gaps))],
  };
};
