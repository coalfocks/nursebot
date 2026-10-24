export type HistoricalAvailability = {
  cutoff: string;
  excluded_after_recorded_at: Record<string, number>;
  excluded_after_event_time: Record<string, number>;
  excluded_rows: Array<{ table: string; id: string; recorded_at: string | null; event_at: string | null; reason: string }>;
  missing_timestamp: string[];
  missing_historical_version: Array<{ table: string; id: string; recorded_at: string | null; event_at: string | null; updated_at: string | null; deleted_at: string | null; reason: string }>;
  unavailable_version_sources: string[];
  recovered_versions: Array<{ table: string; id: string; version: string | number | null; recorded_at: string }>;
  retained_deleted_after_cutoff: Array<{ table: string; id: string; recorded_at: string; event_at: string; deleted_at: string }>;
};

export type HistoricalVersion = Record<string, unknown> & {
  created_at?: string | null;
  encounter_time?: string | null;
  version?: string | number | null;
};

const validTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

const count = (target: Record<string, number>, table: string) => {
  target[table] = (target[table] ?? 0) + 1;
};

export const historicalEventTimestamp = (table: string, row: Record<string, unknown>) => {
  const keys: Record<string, string[]> = {
    chat_messages: ['created_at'],
    medical_orders: ['order_time', 'created_at'],
    lab_results: ['result_time', 'collection_time', 'created_at'],
    vital_signs: ['timestamp', 'created_at'],
    imaging_studies: ['report_generated_at', 'encounter_time', 'order_time', 'created_at'],
    learner_action_events: ['occurred_at', 'created_at'],
    patient_chat_messages: ['created_at'],
    consultant_chat_messages: ['request_receipt_at', 'created_at'],
  };
  return (keys[table] ?? []).map((key) => row[key]).find(validTime) as string | undefined;
};

const versionTimestamp = (row: HistoricalVersion) => row.encounter_time ?? row.created_at;

const usableVersion = (version: HistoricalVersion, cutoffMs: number) =>
  validTime(version.created_at) && new Date(version.created_at).getTime() <= cutoffMs &&
  (!versionTimestamp(version) || (validTime(versionTimestamp(version)) && new Date(versionTimestamp(version) as string).getTime() <= cutoffMs));

const projectImagingVersion = (row: Record<string, unknown>, version: HistoricalVersion) => ({
  ...row,
  report: Object.hasOwn(version, 'report') ? version.report : null,
  body_site: Object.hasOwn(version, 'body_site') ? version.body_site : null,
  laterality: Object.hasOwn(version, 'laterality') ? version.laterality : null,
  contrast: Object.hasOwn(version, 'contrast') ? version.contrast : null,
  indication: Object.hasOwn(version, 'indication') ? version.indication : null,
  findings: Object.hasOwn(version, 'findings') ? version.findings : null,
  impression: Object.hasOwn(version, 'impression') ? version.impression : null,
  status: Object.hasOwn(version, 'status') ? version.status : null,
  encounter_time: Object.hasOwn(version, 'encounter_time') ? version.encounter_time : null,
  report_generated_at: Object.hasOwn(version, 'report_generated_at') ? version.report_generated_at : version.encounter_time ?? version.created_at ?? null,
  order_time: Object.hasOwn(version, 'order_time') ? version.order_time : version.encounter_time ?? version.created_at ?? null,
  record_version: Object.hasOwn(version, 'version') ? version.version : null,
  updated_at: version.created_at ?? row.updated_at,
  historical_available_at: version.report_generated_at ?? version.encounter_time ?? version.created_at ?? null,
  __historical_version_recovered: true,
});

export const filterHistoricalRows = (
  table: string,
  sourceRows: Record<string, unknown>[],
  completedAt: string,
  versions: HistoricalVersion[] = [],
) => {
  const availability: HistoricalAvailability = {
    cutoff: completedAt,
    excluded_after_recorded_at: {},
    excluded_after_event_time: {},
    excluded_rows: [],
    missing_timestamp: [],
    missing_historical_version: [],
    unavailable_version_sources: [],
    recovered_versions: [],
    retained_deleted_after_cutoff: [],
  };
  const cutoffMs = new Date(completedAt).getTime();
  if (Number.isNaN(cutoffMs)) throw new Error('CONTEXT_UNRECOVERABLE:invalid completion cutoff');
  const versionById = new Map<string, HistoricalVersion[]>();
  for (const version of versions) {
    const id = String(version.study_id ?? version.id ?? '');
    if (!id) continue;
    versionById.set(id, [...(versionById.get(id) ?? []), version]);
  }

  const kept: Record<string, unknown>[] = [];
  for (const row of sourceRows) {
    const id = String(row.id ?? 'unknown');
    const recordedAt = row.created_at;
    const eventAt = historicalEventTimestamp(table, row);
    const deletedAt = validTime(row.deleted_at) ? new Date(row.deleted_at).getTime() : null;
    const updatedAt = validTime(row.updated_at) ? new Date(row.updated_at).getTime() : null;
    const history = versionById.get(id) ?? [];
    const historicalVersion = history.filter((version) => usableVersion(version, cutoffMs)).sort((a, b) =>
      new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime())[0];

    if (!validTime(recordedAt)) {
      availability.missing_timestamp.push(`${table}:${id}:created_at`);
      continue;
    }
    if (new Date(recordedAt).getTime() > cutoffMs) {
      count(availability.excluded_after_recorded_at, table);
      availability.excluded_rows.push({ table, id, recorded_at: recordedAt, event_at: eventAt ?? null, reason: 'recorded_after_completion' });
      continue;
    }
    if (!eventAt) {
      availability.missing_timestamp.push(`${table}:${id}:event_time`);
      continue;
    }
    const eventAfterCutoff = new Date(eventAt).getTime() > cutoffMs;
    const deletedBeforeCutoff = deletedAt !== null && deletedAt <= cutoffMs;
    const needsHistoricalVersion = (updatedAt !== null && updatedAt > cutoffMs) || eventAfterCutoff || (deletedAt !== null && deletedAt > cutoffMs);
    if (deletedBeforeCutoff) {
      availability.missing_historical_version.push({ table, id, recorded_at: recordedAt, event_at: eventAt, updated_at: validTime(row.updated_at) ? row.updated_at : null, deleted_at: row.deleted_at as string, reason: 'deleted_before_completion' });
      continue;
    }
    if (needsHistoricalVersion && historicalVersion && table === 'imaging_studies') {
      const recovered = projectImagingVersion(row, historicalVersion);
      availability.recovered_versions.push({ table, id, version: historicalVersion.version ?? null, recorded_at: String(historicalVersion.created_at) });
      kept.push(recovered);
      continue;
    }
    if (eventAfterCutoff) {
      count(availability.excluded_after_event_time, table);
      availability.excluded_rows.push({ table, id, recorded_at: recordedAt, event_at: eventAt, reason: 'event_after_completion' });
      continue;
    }
    if (needsHistoricalVersion && table === 'imaging_studies' && !historicalVersion) {
      availability.missing_historical_version.push({ table, id, recorded_at: recordedAt, event_at: eventAt, updated_at: validTime(row.updated_at) ? row.updated_at : null, deleted_at: validTime(row.deleted_at) ? row.deleted_at : null, reason: deletedAt !== null && deletedAt <= cutoffMs ? 'deleted_before_completion' : 'edited_after_completion' });
      continue;
    }
    if (updatedAt !== null && updatedAt > cutoffMs) {
      availability.missing_historical_version.push({ table, id, recorded_at: recordedAt, event_at: eventAt, updated_at: row.updated_at as string, deleted_at: validTime(row.deleted_at) ? row.deleted_at : null, reason: 'edited_after_completion' });
      continue;
    }
    if (deletedAt !== null && deletedAt > cutoffMs) availability.retained_deleted_after_cutoff.push({ table, id, recorded_at: recordedAt, event_at: eventAt, deleted_at: row.deleted_at as string });
    kept.push(row);
  }
  return { rows: kept, availability };
};
