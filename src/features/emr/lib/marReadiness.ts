export type LearnerMarLoadState =
  | { kind: 'ready'; caseVersion: string }
  | { kind: 'missing_snapshot'; message: string }
  | { kind: 'schema_unavailable'; message: string };

export const learnerMarLoadState = (
  caseVersion: string | null | undefined,
  schemaReady: boolean,
): LearnerMarLoadState => {
  if (!caseVersion?.trim()) {
    return {
      kind: 'missing_snapshot',
      message:
        'Medication history is unavailable for this attempt because it has no immutable MAR snapshot. This historical attempt was not repinned or changed.',
    };
  }
  if (!schemaReady) {
    return {
      kind: 'schema_unavailable',
      message: 'Medication history is temporarily unavailable because the MAR reader is not ready.',
    };
  }
  return { kind: 'ready', caseVersion: caseVersion.trim() };
};
