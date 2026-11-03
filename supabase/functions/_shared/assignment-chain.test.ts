import { describe, expect, it } from 'vitest';
import {
  beginAssignmentChain,
  createAssignmentChain,
  getAssignmentChainReadiness,
  readAssignmentChainPriorStageContext,
  readAssignmentChainPriorStageContextForAssignment,
} from './assignment-chain.ts';

const client = (response: { data: unknown; error: { code?: string; message?: string } | null }) => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return response;
  },
});

describe('assignment-chain server boundary', () => {
  it('does not pass viewer identity and forwards the frozen ordered envelope', async () => {
    const rpc = client({ data: { complete: true }, error: null });
    const result = await createAssignmentChain(rpc, {
      chainId: 'chain-1',
      orderedAssignmentIds: ['a', 'b', 'c'],
      envelope: { assignments: ['server-bound-envelope'] },
    });
    expect(result.status).toBe('ready');
    expect(rpc.calls[0]).toEqual({
      name: 'create_assignment_chain_with_snapshots',
      args: {
        p_chain_id: 'chain-1',
        p_ordered_assignment_ids: ['a', 'b', 'c'],
        p_envelope: { assignments: ['server-bound-envelope'] },
      },
    });
    expect(rpc.calls[0].args).not.toHaveProperty('viewerId');
  });

  it('fails closed when the additive schema is absent', async () => {
    const rpc = client({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } });
    await expect(readAssignmentChainPriorStageContext(rpc, { chainId: 'chain-1', targetAssignmentId: 'b' }))
      .resolves.toEqual({ status: 'unavailable' });
    await expect(getAssignmentChainReadiness(rpc)).resolves.toEqual({ status: 'unavailable' });
  });

  it('does not classify assignment-chain business errors as missing schema', async () => {
    const rpc = client({ data: null, error: { code: 'P0001', message: 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH' } });
    await expect(createAssignmentChain(rpc, {
      chainId: 'chain-1', orderedAssignmentIds: ['a', 'b', 'c'], envelope: { assignments: [] },
    })).resolves.toEqual({ status: 'error', error: { code: 'P0001', message: 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH' } });
  });

  it('starts the prospective intent without exposing viewer identity', async () => {
    const rpc = client({ data: { ready: true }, error: null });
    await expect(beginAssignmentChain(rpc, {
      chainId: 'chain-1', orderedAssignmentIds: ['a', 'b', 'c'], envelope: { assignments: [] },
    })).resolves.toEqual({ status: 'ready', result: { ready: true } });
    expect(rpc.calls[0].name).toBe('begin_assignment_chain_intent');
    expect(rpc.calls[0].args).not.toHaveProperty('viewerId');
  });

  it('does not expose non-array or RPC-error content as learner snapshots', async () => {
    const invalid = client({ data: { envelope: 'private' }, error: null });
    await expect(readAssignmentChainPriorStageContext(invalid, { chainId: 'chain-1', targetAssignmentId: 'b' }))
      .resolves.toEqual({ status: 'hidden', code: 'ASSIGNMENT_CHAIN_INVALID_RESPONSE' });
    const denied = client({ data: null, error: { code: 'ASSIGNMENT_CHAIN_NOT_VISIBLE' } });
    await expect(readAssignmentChainPriorStageContext(denied, { chainId: 'chain-1', targetAssignmentId: 'b' }))
      .resolves.toEqual({ status: 'hidden', code: 'ASSIGNMENT_CHAIN_NOT_VISIBLE' });
  });

  it('resolves learner context by assignment without accepting a client chain id', async () => {
    const rpc = client({ data: [{ sourceStage: 'A', content: 'frozen' }], error: null });
    await expect(readAssignmentChainPriorStageContextForAssignment(rpc, { targetAssignmentId: 'b' }))
      .resolves.toEqual({ status: 'ready', snapshots: [{ sourceStage: 'A', content: 'frozen' }] });
    expect(rpc.calls[0]).toEqual({
      name: 'get_assignment_chain_prior_stage_context_for_assignment',
      args: { p_target_assignment_id: 'b' },
    });
  });
});
