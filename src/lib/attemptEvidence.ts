export type AttemptEvidence = {
  id: string;
  kind: string;
  title: string;
  body: string;
  timestamp: string;
};

type ChatRow = { id: string | number; role: string; content: string; created_at: string | null };
type ConsultantChatRow = ChatRow & { specialty?: string | null; urgency?: string | null };
type OrderRow = { id: string | number; order_name: string; status?: string | null; priority?: string | null; frequency?: string | null; created_at: string | null; order_time?: string | null };
type LabRow = { id: string | number; test_name: string; value?: number | string | null; unit?: string | null; status?: string | null; created_at: string | null; result_time?: string | null; collection_time?: string | null };
type ImagingRow = { id: string | number; order_name?: string | null; study_type: string; status?: string | null; report?: string | null; created_at: string | null; report_generated_at?: string | null; order_time?: string | null };
type VitalRow = { id: string | number; timestamp: string | null; temperature?: number | null; heart_rate?: number | null; respiratory_rate?: number | null; oxygen_saturation?: number | null; blood_pressure_systolic?: number | null; blood_pressure_diastolic?: number | null };

const isAfterBoundary = (timestamp: string | null, boundary: number) => Boolean(timestamp && new Date(timestamp).getTime() >= boundary);

export const buildAttemptEvidence = ({
  chat,
  patientChat,
  consultantChat,
  orders,
  labs,
  imaging,
  vitals,
  progressNote,
  completedAt,
  boundary,
}: {
  chat: ChatRow[];
  patientChat: ChatRow[];
  consultantChat?: ConsultantChatRow[];
  orders: OrderRow[];
  labs: LabRow[];
  imaging: ImagingRow[];
  vitals: VitalRow[];
  progressNote: string | null;
  completedAt: string | null;
  boundary: number;
}): AttemptEvidence[] => {
  const evidence: AttemptEvidence[] = [];
  const addMessage = (row: ChatRow, title: string, idPrefix = 'message') => {
    if (!row.content || row.content === '<completed>' || !isAfterBoundary(row.created_at, boundary)) return;
    evidence.push({ id: `${idPrefix}-${row.id}`, kind: idPrefix === 'consultant-message' ? 'consultant-message' : 'message', title, body: row.content, timestamp: row.created_at! });
  };

  chat.forEach((row) => addMessage(row, row.role === 'student' || row.role === 'user' ? 'Student message' : 'Nurse message'));
  patientChat.forEach((row) => addMessage(row, row.role === 'student' || row.role === 'user' || row.role === 'learner' ? 'Student to patient' : 'Patient response', 'patient-message'));
  (consultantChat ?? []).forEach((row) => addMessage(row, row.role === 'student' || row.role === 'user' || row.role === 'learner' ? 'Student consultant request' : 'Consultant response', 'consultant-message'));
  orders.forEach((row) => {
    const timestamp = row.created_at ?? row.order_time ?? null;
    if (!isAfterBoundary(timestamp, boundary)) return;
    evidence.push({ id: `order-${row.id}`, kind: 'order', title: `Order: ${row.order_name}`, body: [row.priority, row.frequency, row.status].filter(Boolean).join(' · '), timestamp: timestamp! });
  });
  labs.forEach((row) => {
    const timestamp = row.created_at ?? row.result_time ?? row.collection_time ?? null;
    if (!isAfterBoundary(timestamp, boundary)) return;
    evidence.push({ id: `lab-${row.id}`, kind: 'lab-result', title: `Lab result: ${row.test_name}`, body: `${row.test_name}: ${row.value ?? 'resulted'}${row.unit ? ` ${row.unit}` : ''} · ${row.status ?? 'Unknown'}`, timestamp: timestamp! });
  });
  imaging.forEach((row) => {
    const timestamp = row.created_at ?? row.report_generated_at ?? row.order_time ?? null;
    if (!isAfterBoundary(timestamp, boundary)) return;
    evidence.push({ id: `imaging-${row.id}`, kind: 'imaging', title: `Imaging: ${row.order_name || row.study_type}`, body: [row.status, row.report].filter(Boolean).join(' · '), timestamp: timestamp! });
  });
  vitals.forEach((row) => {
    if (!isAfterBoundary(row.timestamp, boundary)) return;
    const values = [
      row.temperature == null ? null : `Temp ${row.temperature}`,
      row.heart_rate == null ? null : `HR ${row.heart_rate}`,
      row.respiratory_rate == null ? null : `RR ${row.respiratory_rate}`,
      row.oxygen_saturation == null ? null : `SpO₂ ${row.oxygen_saturation}`,
      row.blood_pressure_systolic == null || row.blood_pressure_diastolic == null ? null : `BP ${row.blood_pressure_systolic}/${row.blood_pressure_diastolic}`,
    ].filter(Boolean).join(' · ');
    evidence.push({ id: `vital-${row.id}`, kind: 'vital', title: 'Vitals', body: values, timestamp: row.timestamp! });
  });
  if (progressNote?.trim() && isAfterBoundary(completedAt, boundary)) {
    evidence.push({ id: 'progress-note-attempt', kind: 'progress-note', title: 'Student progress note', body: progressNote.trim(), timestamp: completedAt! });
  }
  return Array.from(new Map(evidence.map((row) => [row.id, row])).values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

export const evidenceQueryErrorMessage = (errors: Array<{ label: string; error: unknown }>) => {
  const failed = errors.filter(({ error }) => Boolean(error)).map(({ label, error }) => `${label}: ${error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error)}`);
  return failed.length ? `Unable to load attempt evidence (${failed.join('; ')}). Refresh and try again.` : null;
};
