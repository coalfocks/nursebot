/**
 * The first-page boundary belongs to an assignment, not to reusable room
 * metadata.  Keep invalid/missing values absent so the display adapter uses
 * its honest "During encounter" fallback.
 */
export function resolveAssignmentEncounterAnchor(value: unknown): string | null {
  const candidate = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? ['firstPageAt', 'first_page_at', 'scoringStartAt', 'scoring_start_at', 'occurredAt', 'occurred_at', 'timestamp']
        .map((key) => (value as Record<string, unknown>)[key])
        .find((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      : null;
  if (!candidate?.trim()) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}
