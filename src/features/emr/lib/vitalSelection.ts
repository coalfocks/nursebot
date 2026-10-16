import type { VitalSigns } from './types';

export const selectLatestVitals = (vitals: VitalSigns[], assignmentId?: string): VitalSigns | undefined => {
  const scoped = assignmentId ? vitals.filter((vital) => vital.assignmentId === assignmentId || vital.overrideScope === 'assignment') : [];
  const candidates = scoped.length ? scoped : vitals;
  return [...candidates].sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
  })[0];
};
