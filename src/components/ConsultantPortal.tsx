import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Props = { assignmentId: string; open: boolean; onClose: () => void };
type Message = { role: 'student' | 'consultant'; content: string; specialty?: string; urgency?: string };

// Keep this list in the same order and with the same values as the Edge
// Function allowlist. Attending is intentionally first, but never selected
// implicitly: the learner must choose a consultant.
export const CONSULTANT_SPECIALTIES = [
  'Attending',
  'Medicine',
  'Surgery',
  'Pediatrics',
  'OB/GYN',
  'Cardiology',
  'ICU',
  'Neurology',
  'Nephrology',
  'Infectious Disease',
  'Orthopedics',
  'ENT',
  'Anesthesiology',
  'Endocrinology',
  'Hematology',
  'Toxicology',
  'Pediatric Hepatology',
  'Pediatric Cardiology',
  'Pediatric Surgery',
  'Pediatric Emergency Medicine',
  'Oncology',
  'Pulmonology',
  'Gastroenterology',
] as const;
const urgencyOptions = [
  { value: 'routine', label: 'Routine — see the patient in the morning' },
  { value: 'urgent', label: 'Urgent — needs attention today' },
  { value: 'emergent', label: 'Emergent — immediate response needed' },
];

export function ConsultantPortal({ assignmentId, open, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [specialty, setSpecialty] = useState('');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState('');
  const [question, setQuestion] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);

  const filteredSpecialties = useMemo(() => CONSULTANT_SPECIALTIES.filter((item) => item.toLowerCase().includes(search.trim().toLowerCase())), [search]);

  useEffect(() => {
    if (!open) return;
    // A consultant must be actively selected for each opened composer; never
    // carry Medicine (or a prior selection) into a new request implicitly.
    setSpecialty('');
    setError(null);
    void (supabase as any).from('consultant_chat_messages').select('role, content, specialty, urgency').eq('assignment_id', assignmentId).order('created_at').then(({ data, error: loadError }: { data: Message[] | null; error: Error | null }) => {
      if (loadError) setError(loadError.message);
      if (data) setMessages(data);
    });
  }, [assignmentId, open]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !summary.trim() || !question.trim() || !reason.trim()) return;
    setLoading(true); setError(null);
    const requestId = clientRequestId ?? crypto.randomUUID();
    setClientRequestId(requestId);
    const request = { specialty, summary: summary.trim(), clinicalQuestion: question.trim(), reason: reason.trim(), urgency, clientRequestId: requestId };
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ message: string; disposition?: string; orderId?: string }>('consultant-chat', { body: { assignmentId, request } });
      if (invokeError) throw invokeError;
      if (!data?.message) throw new Error('Consultant response missing');
      setMessages((current) => [...current,
        { role: 'student', content: `${specialty} consult (${urgency}): ${summary.trim()} Question: ${question.trim()} Reason: ${reason.trim()}`, specialty, urgency },
        { role: 'consultant', content: data.message, specialty, urgency },
      ]);
      setDisposition(data.disposition ?? null);
      setSummary(''); setQuestion(''); setReason('');
      setClientRequestId(null);
    } catch (cause) {
      // Supabase wraps non-2xx Edge Function responses. Prefer the server's
      // JSON error so the learner sees the actionable validation/database
      // reason instead of only “Edge Function returned a non-2xx status code”.
      let message = cause instanceof Error ? cause.message : 'Consultant request failed';
      const context = (cause as { context?: Response }).context;
      if (context?.json) {
        try {
          const body = await context.clone().json() as { error?: string; message?: string };
          message = body.error || body.message || message;
        } catch {
          // Keep the original client error when the function did not return JSON.
        }
      }
      setError(message);
    } finally { setLoading(false); }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultant-portal-title">
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-4"><div><h2 id="consultant-portal-title" className="text-lg font-semibold">Consultant Portal</h2><p className="text-xs text-slate-500">Choose the relevant consultant and send a concise summary, question, reason, and urgency.</p></div><button type="button" onClick={onClose} aria-label="Close consultant portal"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-3 border-b p-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Specialty
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Search specialties…" aria-label="Search consultant specialties" />
          <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consultant specialty" required>
            <option value="">Choose a consultant</option>
            {filteredSpecialties.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Urgency<select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consult request urgency">{urgencyOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-sm font-medium sm:col-span-2">Concise patient summary<textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Relevant presentation, findings, and current status" required /></label>
        <label className="text-sm font-medium">Clinical question<textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="What do you need the consultant to advise?" required /></label>
        <label className="text-sm font-medium">Reason for consult<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Why this specialty is needed" required /></label>
      </div>
      <div className="min-h-[180px] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">{messages.length === 0 && <p className="text-sm text-slate-500">No consultant requests yet.</p>}{messages.map((message, index) => <div key={`${index}-${message.content}`} className={`rounded-lg p-3 text-sm ${message.role === 'student' ? 'ml-8 bg-blue-50' : 'mr-8 bg-white shadow-sm'}`}><span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'Consult request' : 'Consultant response'}</span>{message.content}</div>)}</div>
      {disposition === 'assumes_care' && <p className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900">The consultant has assumed care. Follow the case-ending instructions in the encounter.</p>}
      {error && <p role="alert" className="border-t bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
      <form onSubmit={send} className="flex justify-end gap-2 border-t p-4"><button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Close</button><button type="submit" disabled={loading || !specialty || !summary.trim() || !question.trim() || !reason.trim()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send consult request</button></form>
    </div>
  </div>;
}
