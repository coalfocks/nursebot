// Reads a stored baseline snapshot for the feedback packet and the timeline reference block.
// A missing row is "unavailable", never an empty list: an empty list is a confirmed absence,
// and only a stored snapshot can confirm one.

export const BASELINE_SNAPSHOT_VERSION = 'baseline-snapshot-v1-2026-11-19';

export type BaselineEntry = {
  name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  indication: string | null;
  status: 'active' | 'discontinued' | 'expired' | 'unknown';
  kind: 'scheduled' | 'prn' | 'monitoring' | 'other';
};

export type BaselineReference =
  | { status: 'unavailable'; reason: string }
  | { status: 'captured'; captured_at: string; baseline_version: string; medications: BaselineEntry[]; active_orders: BaselineEntry[] };

const entryList = (value: unknown): BaselineEntry[] | null => {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const str = (key: string) => typeof row[key] === 'string' && (row[key] as string).trim() ? (row[key] as string).trim() : null;
    const status = str('status');
    const kind = str('kind');
    return {
      name: str('name') ?? 'Unnamed baseline item',
      dose: str('dose'),
      route: str('route'),
      frequency: str('frequency'),
      indication: str('indication'),
      status: status === 'active' || status === 'discontinued' || status === 'expired' ? status : 'unknown',
      kind: kind === 'scheduled' || kind === 'prn' || kind === 'monitoring' ? kind : 'other',
    };
  });
};

export const readBaselineSnapshot = (row: Record<string, unknown> | null | undefined): BaselineReference => {
  if (!row) return { status: 'unavailable', reason: 'No verified historical baseline was captured for this attempt.' };
  const medications = entryList(row.medications);
  const activeOrders = entryList(row.active_orders);
  if (!medications || !activeOrders) return { status: 'unavailable', reason: 'The stored baseline is malformed; it was not used.' };
  if (typeof row.captured_at !== 'string' || typeof row.baseline_version !== 'string') {
    return { status: 'unavailable', reason: 'The stored baseline has no capture time or version; it was not used.' };
  }
  return { status: 'captured', captured_at: row.captured_at, baseline_version: row.baseline_version, medications, active_orders: activeOrders };
};

// Reference block for the timeline and scorer. States which values are confirmed and which are unavailable.
export const renderBaselineReference = (baseline: BaselineReference): string[] => {
  if (baseline.status === 'unavailable') return [`Patient medications and active orders before case start: unavailable (${baseline.reason})`];
  const line = (item: BaselineEntry) => `${item.name}${item.dose ? `, ${item.dose}` : ''}${item.route ? ` ${item.route}` : ''}${item.frequency ? `, ${item.frequency}` : ''}${item.indication ? ` (for ${item.indication})` : ''} [${item.status}, ${item.kind}]`;
  const medicationLines = baseline.medications.length
    ? baseline.medications.map((item) => `- Medication: ${line(item)}`)
    : ['- Medications: none recorded in the verified baseline.'];
  const orderLines = baseline.active_orders.length
    ? baseline.active_orders.map((item) => `- Order: ${line(item)}`)
    : ['- Active orders: none recorded in the verified baseline.'];
  return [
    `Patient medications and active orders before case start (baseline ${baseline.baseline_version}, captured ${baseline.captured_at}):`,
    ...medicationLines,
    ...orderLines,
  ];
};
