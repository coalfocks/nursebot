/**
 * The completed_at value read back from the database after the completion UPDATE. The database stamps it with the
 * server clock on the first transition to completed and ignores the browser value, so the browser clock must not be
 * kept as the local copy. Returns null when the read-back carries no valid timestamp (unknown, never estimated).
 */
export const savedCompletedAtFrom = (row: unknown): string | null => {
  if (!row || typeof row !== 'object') return null;
  const value = (row as { completed_at?: unknown }).completed_at;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
};
