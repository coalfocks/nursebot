import type { MarAdministrationEvent, MedicalOrder, Patient } from './types';

export const medicationOrderCategory = (order: MedicalOrder): MarAdministrationEvent['category'] => {
  const frequency = (order.frequency ?? '').trim().toLowerCase();
  const instructions = (order.instructions ?? '').trim().toLowerCase();
  if (frequency === 'prn' || frequency.includes(' prn') || instructions.includes('prn')) return 'prn';
  if (/^once$|one[- ]?time/.test(frequency)) return 'one_time';
  return 'scheduled';
};

export type MarMedicationRow = {
  key: string;
  order?: MedicalOrder;
  representative: MarAdministrationEvent;
  administrations: MarAdministrationEvent[];
  orderOnly: boolean;
};

/**
 * Orders are medication identity/metadata. Only persisted MAR events belong
 * in administrations; an order without events must never become a fake dose.
 */
export function projectMedicationRows(
  events: MarAdministrationEvent[],
  orders: MedicalOrder[],
  patient: Patient,
  caseVersion: string | null | undefined,
  categoryFilter: 'all' | MarAdministrationEvent['category'],
  search: string,
): MarMedicationRow[] {
  const grouped = new Map<string, { order?: MedicalOrder; administrations: MarAdministrationEvent[] }>();
  events.forEach((event) => {
    const key = event.orderId ?? `manual:${event.medicationName}`;
    const row = grouped.get(key) ?? { administrations: [] };
    row.administrations.push(event);
    grouped.set(key, row);
  });
  const normalizedSearch = search.trim().toLowerCase();
  orders
    // Keep every authored order as a row. Category filtering applies to the
    // resulting medication row, not to the order before its metadata is
    // joined with administrations; otherwise a q4h PRN order disappears.
    .filter((order) => !normalizedSearch || order.orderName.toLowerCase().includes(normalizedSearch))
    .forEach((order) => {
      const row = grouped.get(order.id) ?? { administrations: [] };
      row.order = order;
      grouped.set(order.id, row);
    });

  return Array.from(grouped.entries()).map(([key, row]) => {
    const category = row.order ? medicationOrderCategory(row.order) : row.administrations[0]?.category ?? 'scheduled';
    // Order metadata is authoritative for the current medication summary.
    // Historical administrations may intentionally contain an older dose or
    // route and must remain history, never overwrite today's order summary.
    const representative = row.order ? {
      id: `order-row:${key}`,
      patientId: row.order.patientId,
      roomId: row.order.roomId ?? patient.roomId ?? 0,
      assignmentId: row.order.assignmentId ?? null,
      orderId: row.order.id,
      caseVersion,
      occurrenceKey: `order-row:${key}`,
      relativeOffsetHours: null,
      administeredAt: null,
      medicationName: row.order.orderName,
      orderedDose: row.order.dose ?? null,
      administeredDose: null,
      unit: null,
      route: row.order.route ?? null,
      frequency: row.order.frequency ?? null,
      category,
      status: 'Not documented' as const,
      source: 'authored_scenario' as const,
    } : row.administrations.find((event) => event.status === 'Given') ?? row.administrations[0] ?? {
      id: `order-row:${key}`,
      patientId: row.order?.patientId ?? patient.id,
      roomId: row.order?.roomId ?? patient.roomId ?? 0,
      assignmentId: row.order?.assignmentId ?? null,
      orderId: row.order?.id ?? null,
      caseVersion,
      occurrenceKey: `order-row:${key}`,
      relativeOffsetHours: null,
      administeredAt: null,
      medicationName: row.order?.orderName ?? 'Medication',
      orderedDose: row.order?.dose ?? null,
      administeredDose: null,
      unit: null,
      route: row.order?.route ?? null,
      frequency: row.order?.frequency ?? null,
      category,
      status: 'Not documented' as const,
      source: 'authored_scenario' as const,
    };
    return {
      key,
      order: row.order,
      representative,
      administrations: [...row.administrations].sort((a, b) => (b.relativeOffsetHours ?? -1) - (a.relativeOffsetHours ?? -1)),
      orderOnly: row.administrations.length === 0 && Boolean(row.order),
    };
  }).filter((row) => categoryFilter === 'all' || row.representative.category === categoryFilter)
    .sort((a, b) => a.representative.medicationName.localeCompare(b.representative.medicationName));
}
