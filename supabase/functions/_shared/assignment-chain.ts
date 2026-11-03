/**
 * Server-only adapter for the prospective assignment-chain RPCs.
 *
 * The RPCs derive auth.uid(), ownership, activation, completion, and
 * materialization from persisted rows. This adapter deliberately does not
 * accept a viewer id or expose the stored full envelope to learner clients.
 * Until the migration is applied, callers receive `unavailable` and retain
 * the existing baseline-note behavior.
 */

export type AssignmentChainRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
};

export type AssignmentChainReadResult =
  | { status: 'ready'; snapshots: unknown[] }
  | { status: 'unavailable' }
  | { status: 'hidden'; code: string };

const missingSchemaCodes = new Set(['PGRST202', '42P01', '42883']);

const isMissingChainSchema = (error: { code?: string | null; message?: string | null } | null) => {
  if (!error) return false;
  if (error.code && missingSchemaCodes.has(error.code)) return true;
  return /assignment_chain|function .* does not exist|relation .* does not exist/i.test(error.message ?? '');
};

export const createAssignmentChain = async (
  client: AssignmentChainRpcClient,
  input: {
    chainId: string;
    orderedAssignmentIds: string[];
    envelope: Record<string, unknown>;
  },
) => {
  const response = await client.rpc('create_assignment_chain_with_snapshots', {
    p_chain_id: input.chainId,
    p_ordered_assignment_ids: input.orderedAssignmentIds,
    p_envelope: input.envelope,
  });
  if (isMissingChainSchema(response.error)) return { status: 'unavailable' as const };
  if (response.error) return { status: 'error' as const, error: response.error };
  return { status: 'ready' as const, result: response.data };
};

export const readAssignmentChainPriorStageContext = async (
  client: AssignmentChainRpcClient,
  input: { chainId: string; targetAssignmentId: string },
): Promise<AssignmentChainReadResult> => {
  const response = await client.rpc('get_assignment_chain_prior_stage_context', {
    p_chain_id: input.chainId,
    p_target_assignment_id: input.targetAssignmentId,
  });
  if (isMissingChainSchema(response.error)) return { status: 'unavailable' };
  if (response.error) return { status: 'hidden', code: response.error.code ?? 'ASSIGNMENT_CHAIN_NOT_VISIBLE' };
  if (!Array.isArray(response.data)) return { status: 'hidden', code: 'ASSIGNMENT_CHAIN_INVALID_RESPONSE' };
  return { status: 'ready', snapshots: response.data };
};

export const getAssignmentChainReadiness = async (client: AssignmentChainRpcClient) => {
  const response = await client.rpc('get_assignment_chain_readiness', {});
  if (isMissingChainSchema(response.error)) return { status: 'unavailable' as const };
  if (response.error) return { status: 'error' as const, error: response.error };
  return { status: 'ready' as const, readiness: response.data };
};
