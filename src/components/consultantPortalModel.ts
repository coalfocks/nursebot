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

export { CONSULTANT_DIRECTORY };
export const getConsultantThreadKey = (assignmentId: string, audience: Audience, specialty: string) => `${assignmentId}:${audience}:${specialty}`;
export const filterConsultantMessages = (messages: Message[], audience: Audience, specialty: string) => messages.filter((message) => message.audience === audience && message.specialty === specialty);
export const sortConsultantMessages = (messages: Message[]) => [...messages].sort((left, right) => (
  (left.request_receipt_at ?? left.request_created_at ?? left.created_at ?? '').localeCompare(right.request_receipt_at ?? right.request_created_at ?? right.created_at ?? '')
  || ((left.message_sequence ?? 999) - (right.message_sequence ?? 999))
  || (left.created_at ?? '').localeCompare(right.created_at ?? '')
  || left.id.localeCompare(right.id)
));
