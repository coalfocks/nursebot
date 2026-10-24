export type FacultyStudyResultWrite = {
  batchId: string;
  batchOrdinal: number;
  leaseToken: string;
  assignmentId: string;
  historicalSnapshot: Record<string, unknown>;
  frozenInput: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  canonicalResult: Record<string, unknown> | null;
  rawModelResponse: unknown;
  error: Record<string, unknown> | null;
  promptVersion: string;
  model: string;
  generatedAt: string | null;
};

export const writeOwnedFacultyStudyResult = async (client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, write: FacultyStudyResultWrite) => {
  const { data, error } = await client.rpc('write_faculty_study_result_owned', {
    p_batch_id: write.batchId,
    p_batch_ordinal: write.batchOrdinal,
    p_lease_token: write.leaseToken,
    p_assignment_id: write.assignmentId,
    p_historical_snapshot: write.historicalSnapshot,
    p_frozen_input: write.frozenInput,
    p_result: write.result,
    p_canonical_result: write.canonicalResult,
    p_raw_model_response: write.rawModelResponse,
    p_error: write.error,
    p_prompt_version: write.promptVersion,
    p_model: write.model,
    p_generated_at: write.generatedAt,
  });
  if (error) throw error;
  if (data !== true) throw new Error('STUDY_RUN_LEASE_LOST');
};
