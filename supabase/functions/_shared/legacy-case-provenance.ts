export type LegacyArchiveRow = Record<string, unknown>;

export type LegacyCaseIdentity = {
  patientId: string | null;
  schoolId: string | null;
  roomId: number | null;
  pinnedCaseVersion: string | null;
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
  if (authoredConflict) flags.push('case_lineage_conflict_pinned_assignment_over_authored');

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
    usable_at_completion: row === pinned,
    exclusion_reason: row === pinned ? null : identityMatches(row, identity) ? 'not_selected_pinned_version' : 'patient_school_or_room_mismatch',
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
    usable_at_completion: row === authored && !pinned,
    exclusion_reason: row === authored && !pinned ? null : identityMatches(row, identity) ? (pinned ? 'pinned_assignment_version_takes_precedence' : 'not_selected_completion_version') : 'patient_school_or_room_mismatch',
  });

  if (assignmentRows.length && !pinned) flags.push('assignment_case_version_missing_at_completion');
  if (authoredRows.length && !authored) flags.push('authored_case_version_missing_at_completion');
  const selected = pinned ?? (authoredConflict ? null : authored);
  const resolvedCaseVersion = identity.pinnedCaseVersion ?? selected?.case_version ?? null;
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
    archive_content_scope: selected && !hasFullScenarioBaseline ? 'orders_and_events_only' : hasFullScenarioBaseline ? 'full_assignment_scenario_baseline' : null,
    assignment_baseline_version: pinned,
    authored_case_version: authored,
    references,
    identity_excluded_references: identityExcluded,
    missing_history_flags: flags,
  };
};
