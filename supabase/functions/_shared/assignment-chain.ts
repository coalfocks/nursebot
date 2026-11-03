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

const isMissingChainSchema = (error: { code?: string | null; message?: string | null } | null) => {
  if (!error) return false;
  const message = error.message ?? '';
  if (error.code === 'PGRST202') return /function .*does not exist|could not find the function/i.test(message);
  if (error.code === '42P01') return /relation .*assignment_chain/i.test(message);
  if (error.code === '42883') return /function .*assignment_chain.*does not exist/i.test(message);
  return false;
};

export const beginAssignmentChain = async (
  client: AssignmentChainRpcClient,
  input: {
    chainId: string;
    orderedAssignmentIds: string[];
    envelope: Record<string, unknown>;
  },
) => {
  const response = await client.rpc('begin_assignment_chain_intent', {
    p_chain_id: input.chainId,
    p_ordered_assignment_ids: input.orderedAssignmentIds,
    p_envelope: input.envelope,
  });
  if (isMissingChainSchema(response.error)) return { status: 'unavailable' as const };
  if (response.error) return { status: 'error' as const, error: response.error };
  return { status: 'ready' as const, result: response.data };
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
