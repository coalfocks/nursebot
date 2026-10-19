import { CONSULTANT_DIRECTORY } from '../../supabase/functions/_shared/consultant-directory';

export type Audience = 'adult' | 'pediatric';
export type Message = {
  id: string;
  role: 'student' | 'consultant';
  content: string;
  specialty: string | null;
  audience: Audience | null;
  created_at?: string;
  request_id?: string | null;
  consult_order_id?: string | null;
};

export { CONSULTANT_DIRECTORY };
export const getConsultantThreadKey = (assignmentId: string, audience: Audience, specialty: string) => `${assignmentId}:${audience}:${specialty}`;
export const filterConsultantMessages = (messages: Message[], audience: Audience, specialty: string) => messages.filter((message) => message.audience === audience && message.specialty === specialty);
