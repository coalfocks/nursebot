import type { MedicalOrder } from './types';
import { instantLabs } from './labCatalog';

/**
 * STAT instant labs must result even when the learner has already marked the
 * order complete. Completion is a lifecycle update, not a reason to discard
 * the gated result.
 */
export function isResultProducingStatLab(order: Pick<MedicalOrder, 'category' | 'priority' | 'status' | 'orderName'>): boolean {
  if (order.category !== 'Lab' || order.priority !== 'STAT') return false;
  const name = order.orderName.trim().toLowerCase().replace(/\bstat\b/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return false;
  // The authoring/order UI commonly stores this as "CBC" while the catalog
  // uses "CBC with Differential". Treat that canonical shorthand as the same
  // result-producing STAT lab; do not broaden this to arbitrary lab orders.
  if (name === 'cbc' || name.startsWith('cbc ')) return true;
  return instantLabs.some((lab) => {
    const catalogName = lab.toLowerCase();
    return name === catalogName || name.includes(catalogName) || catalogName.includes(name);
  });
}
