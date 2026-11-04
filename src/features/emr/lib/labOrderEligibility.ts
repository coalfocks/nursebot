import type { MedicalOrder } from './types';
import { getLabType } from './labOrderDecision';

/**
 * STAT instant labs must result even when the learner has already marked the
 * order complete. Completion is a lifecycle update, not a reason to discard
 * the gated result.
 */
export function isResultProducingStatLab(order: Pick<MedicalOrder, 'category' | 'priority' | 'status' | 'orderName'>): boolean {
  return order.priority === 'STAT' && isResultProducingLab(order);
}

export function isResultProducingLab(order: Pick<MedicalOrder, 'category' | 'orderName'>): boolean {
  return order.category === 'Lab' && getLabType(order.orderName) === 'instant';
}
