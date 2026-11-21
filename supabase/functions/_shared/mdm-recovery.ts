const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
/** Caller must pass only the latest retained run for this assignment; never search older failures. */
export const eligibleMdmRecovery = (value: unknown): boolean => {
  const r = object(value); const timing = object(r.timing);
  if (r.status !== 'rejected' || r.failure_type !== 'timeout' || timing.phase !== 'model_evaluation'
    || timing.deadline_ms !== 90000 || timing.operations?.medical_decision_making?.status !== 'pending') return false;
  if (!Array.isArray(r.model_transport)) return false;
  const mdm = r.model_transport.filter((t: any) => t?.section === 'medical_decision_making');
  if (mdm.length !== 2) return false;
  const [first, second] = mdm;
  return first.status === 'received' && first.http_status === 200 && first.finish_reason === 'length'
    && first.content_bytes === 0 && first.content_characters === 0 && second.status === 'pending';
};
