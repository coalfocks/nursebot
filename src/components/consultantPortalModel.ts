import { CONSULTANT_DIRECTORY } from '../../supabase/functions/_shared/consultant-directory';

export type Audience = 'adult' | 'pediatric';
export type Message = {
  id: string;
  role: 'student' | 'consultant';
  content: string;
  specialty: string | null;
  audience: Audience | null;
  created_at?: string;
  request_receipt_at?: string | null;
  request_created_at?: string | null;
  message_sequence?: number | null;
  request_id?: string | null;
  consult_order_id?: string | null;
};

type V3MessageRow = Omit<Message, 'request_receipt_at' | 'message_sequence' | 'request_created_at'> & {
  request_created_at?: string | null;
};

/** Normalize the deployed v3 message shape without requiring v4 columns. */
export const normalizeConsultantMessages = (
  rows: V3MessageRow[],
  requestCreatedAt: Record<string, string | null | undefined> = {},
): Message[] => rows.map((row) => {
  const requestCreated = row.request_created_at ?? (row.request_id ? requestCreatedAt[row.request_id] ?? null : null);
  return {
    ...row,
    request_created_at: requestCreated,
    request_receipt_at: requestCreated,
    message_sequence: row.role === 'student' ? 1 : row.role === 'consultant' ? 2 : null,
  };
});

export { CONSULTANT_DIRECTORY };
export const getConsultantThreadKey = (assignmentId: string, audience: Audience, specialty: string) => `${assignmentId}:${audience}:${specialty}`;
export const filterConsultantMessages = (messages: Message[], audience: Audience, specialty: string) => messages.filter((message) => message.audience === audience && message.specialty === specialty);
export const sortConsultantMessages = (messages: Message[]) => [...messages].sort((left, right) => (
  (left.request_receipt_at ?? left.request_created_at ?? left.created_at ?? '').localeCompare(right.request_receipt_at ?? right.request_created_at ?? right.created_at ?? '')
  || ((left.message_sequence ?? 999) - (right.message_sequence ?? 999))
  || (left.created_at ?? '').localeCompare(right.created_at ?? '')
  || left.id.localeCompare(right.id)
));
