export type ChainStage = 'A' | 'B' | 'C';

export interface AssignmentChainNode {
  assignmentId: string;
  chainId: string;
  stage: ChainStage;
  status: string;
  completedAt: string | null;
  studentProgressNote: string | null;
}

export interface PriorStageContext {
  sourceAssignmentId: string;
  sourceStage: ChainStage;
  completedAt: string;
  content: string;
}

const stageRank: Record<ChainStage, number> = { A: 0, B: 1, C: 2 };

/**
 * Candidate read-model logic for future chain snapshots. It is intentionally
 * pure: it does not read or write Supabase and therefore cannot alter history.
 */
export const buildPriorStageContext = (
  current: Pick<AssignmentChainNode, 'chainId' | 'stage'>,
  chain: AssignmentChainNode[],
): PriorStageContext[] => chain
  .filter((node) => node.chainId === current.chainId)
  .filter((node) => stageRank[node.stage] < stageRank[current.stage])
  .filter((node) => node.status === 'completed' && Boolean(node.completedAt))
  .filter((node) => Boolean(node.studentProgressNote?.trim()))
  .sort((a, b) => stageRank[a.stage] - stageRank[b.stage])
  .map((node) => ({
    sourceAssignmentId: node.assignmentId,
    sourceStage: node.stage,
    completedAt: node.completedAt as string,
    content: node.studentProgressNote!.trim(),
  }));
