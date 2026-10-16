export type ChatEvidenceRow = { assignment_id: string | null };

export type ChatEvidencePageFetcher = (
  assignmentIds: string[],
  from: number,
  to: number,
) => Promise<{ data: ChatEvidenceRow[] | null; error: Error | null }>;

/**
 * Walk every ordered page for each assignment-ID batch. A bounded first page
 * is not evidence of absence when an assignment has a long transcript.
 */
export const collectPersistedChatAssignmentIds = async (
  assignmentIds: string[],
  fetchPage: ChatEvidencePageFetcher,
  batchSize = 200,
  pageSize = 200,
): Promise<Set<string>> => {
  const result = new Set<string>();
  for (let batchStart = 0; batchStart < assignmentIds.length; batchStart += batchSize) {
    const batch = assignmentIds.slice(batchStart, batchStart + batchSize);
    for (let pageStart = 0; ; pageStart += pageSize) {
      const { data, error } = await fetchPage(batch, pageStart, pageStart + pageSize - 1);
      if (error) throw error;
      const rows = data ?? [];
      rows.forEach((row) => {
        if (row.assignment_id) result.add(row.assignment_id);
      });
      if (rows.length < pageSize) break;
    }
  }
  return result;
};
