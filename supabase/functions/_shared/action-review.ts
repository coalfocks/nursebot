type ActionReviewItem = {
  evidence_event_ids?: unknown;
  [key: string]: unknown;
};

type DeterministicActionEntry = {
  id: string;
  title: string;
  body?: string;
  meta?: string[];
};

const isActionReviewItem = (value: unknown): value is ActionReviewItem =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/**
 * Keeps model-authored action review rows and appends deterministic chart
 * evidence only when the model did not already cite that stable event ID.
 */
export const appendUncitedDeterministicActions = (
  actionReview: unknown[],
  scoredEntries: DeterministicActionEntry[],
): unknown[] => {
  const citedEventIds = new Set(
    actionReview.flatMap((item) => {
      if (!isActionReviewItem(item) || !Array.isArray(item.evidence_event_ids)) return [];
      return item.evidence_event_ids.filter((id): id is string => typeof id === 'string');
    }),
  );

  const deterministicActions = scoredEntries
    .filter((entry) => !citedEventIds.has(entry.id))
    .map((entry) => ({
      label: entry.title,
      action: entry.title,
      status: entry.meta?.join(' • ') ?? 'Observed post-page action',
      explanation: entry.body || 'Persisted post-page evidence observed for this attempt.',
      evidence_event_ids: [entry.id],
    }));

  return [...actionReview, ...deterministicActions];
};
