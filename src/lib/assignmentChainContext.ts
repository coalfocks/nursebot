export type ChainStage = 'A' | 'B' | 'C';

export interface AssignmentChainNode {
  assignmentId: string;
  sourceRoomId: number | null;
  chainId: string;
  stage: ChainStage;
  status: string;
  completedAt: string | null;
  /** Frozen authored room progress note captured when this assignment is created. */
  authoredProgressNote: string | null;
}

export interface PriorStageContext {
  chainId: string;
  targetAssignmentStage: ChainStage;
  sourceAssignmentId: string;
  sourceRoomId: number | null;
  sourceStage: ChainStage;
  completedAt: string;
  capturedAt: string;
  content: string;
}

const stageRank: Record<ChainStage, number> = { A: 0, B: 1, C: 2 };

/**
 * Candidate read-model logic for future chain snapshots. It is intentionally
 * pure: it does not read or write Supabase and therefore cannot alter history.
 */
export const buildPriorStageContext = (
  current: Pick<AssignmentChainNode, 'assignmentId' | 'chainId' | 'stage'>,
  chain: AssignmentChainNode[],
  capturedAt: string,
): PriorStageContext[] => chain
  .filter((node) => node.chainId === current.chainId)
  .filter((node) => node.assignmentId !== current.assignmentId)
  .filter((node) => stageRank[node.stage] < stageRank[current.stage])
  .filter((node) => node.status === 'completed' && Boolean(node.completedAt))
  .filter((node) => Boolean(node.authoredProgressNote?.trim()))
  .sort((a, b) => stageRank[a.stage] - stageRank[b.stage])
  .map((node) => ({
    chainId: current.chainId,
    targetAssignmentStage: current.stage,
    sourceAssignmentId: node.assignmentId,
    sourceRoomId: node.sourceRoomId,
    sourceStage: node.stage,
    completedAt: node.completedAt as string,
    capturedAt,
    content: node.authoredProgressNote!.trim(),
  }));
