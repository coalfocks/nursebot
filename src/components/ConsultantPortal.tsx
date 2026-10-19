import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CONSULTANT_DIRECTORY } from '../../supabase/functions/_shared/consultant-directory';

type Audience = 'adult' | 'pediatric';
type Props = { assignmentId: string; open: boolean; onClose: () => void };
type Message = { role: 'student' | 'consultant'; content: string; specialty?: string; audience?: Audience; created_at?: string };
type Draft = { text: string; clientRequestId: string | null };

export { CONSULTANT_DIRECTORY };
export const getConsultantThreadKey = (audience: Audience, specialty: string) => `${audience}:${specialty}`;
export const filterConsultantMessages = (messages: Message[], audience: Audience, specialty: string) => messages.filter((message) => message.audience === audience && message.specialty === specialty);

const emptyDraft = (): Draft => ({ text: '', clientRequestId: null });

export function ConsultantPortal({ assignmentId, open, onClose }: Props) {
  const [audience, setAudience] = useState<Audience>('adult');
  const [specialty, setSpecialty] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);

  const filteredSpecialties = useMemo(() => CONSULTANT_DIRECTORY.filter((item) => item.audiences.includes(audience) && `${item.label} ${item.value}`.toLowerCase().includes(search.trim().toLowerCase())), [audience, search]);
  const threadKey = getConsultantThreadKey(audience, specialty);
  const draft = drafts[threadKey] ?? emptyDraft();
  const threadMessages = filterConsultantMessages(messages, audience, specialty);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void (supabase as any).from('consultant_chat_messages').select('role, content, specialty, audience, created_at').eq('assignment_id', assignmentId).order('created_at').then(({ data, error: loadError }: { data: Message[] | null; error: Error | null }) => {
      if (loadError) setError(loadError.message);
      if (data) setMessages(data);
    });
  }, [assignmentId, open]);

  const chooseAudience = (next: Audience) => {
    setAudience(next);
    setSpecialty('');
    setSearch('');
    setDisposition(null);
    setError(null);
  };

  const chooseSpecialty = (next: string) => {
    setSpecialty(next);
    setSearch('');
    setDisposition(null);
    setError(null);
  };

  const updateDraft = (text: string) => setDrafts((current) => ({ ...current, [threadKey]: { ...draft, text } }));

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !specialty || !draft.text.trim()) return;
    setLoading(true); setError(null);
    const requestId = draft.clientRequestId ?? crypto.randomUUID();
    setDrafts((current) => ({ ...current, [threadKey]: { ...draft, clientRequestId: requestId } }));
    const message = draft.text.trim();
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ message: string; disposition?: string; orderId?: string }>('consultant-chat', { body: { assignmentId, request: { audience, specialty, message, clientRequestId: requestId } } });
      if (invokeError) throw invokeError;
      if (!data?.message) throw new Error('Consultant response missing');
      setMessages((current) => [...current,
        { role: 'student', content: message, specialty, audience },
        { role: 'consultant', content: data.message, specialty, audience },
      ]);
      setDisposition(data.disposition ?? null);
      setDrafts((current) => ({ ...current, [threadKey]: emptyDraft() }));
    } catch (cause) {
      let messageText = cause instanceof Error ? cause.message : 'Consultant request failed';
      const context = (cause as { context?: Response }).context;
      if (context?.json) {
        try {
          const body = await context.clone().json() as { error?: string; message?: string };
          messageText = body.error || body.message || messageText;
        } catch { /* retain the transport error */ }
      }
      setError(messageText);
    } finally { setLoading(false); }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultant-portal-title">
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-4"><div><h2 id="consultant-portal-title" className="text-lg font-semibold">Consultant Portal</h2><p className="text-xs text-slate-500">Choose the patient population and consultant before sending a message.</p></div><button type="button" onClick={onClose} aria-label="Close consultant portal"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-3 border-b p-4">
        <fieldset><legend className="text-sm font-medium">Patient population</legend><div className="mt-1 flex gap-2" role="radiogroup" aria-label="Patient population"><button type="button" role="radio" aria-checked={audience === 'adult'} onClick={() => chooseAudience('adult')} className={`rounded-md border px-3 py-2 text-sm ${audience === 'adult' ? 'border-blue-600 bg-blue-50 text-blue-800' : ''}`}>Adult</button><button type="button" role="radio" aria-checked={audience === 'pediatric'} onClick={() => chooseAudience('pediatric')} className={`rounded-md border px-3 py-2 text-sm ${audience === 'pediatric' ? 'border-blue-600 bg-blue-50 text-blue-800' : ''}`}>Pediatric</button></div></fieldset>
        <label className="text-sm font-medium">Consultant service<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Search adult or pediatric consultants…" aria-label="Search consultant services" /><select value={specialty} onChange={(e) => chooseSpecialty(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consultant service"><option value="">Choose a consultant</option>{filteredSpecialties.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <div className="min-h-[180px] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">{!specialty && <p className="text-sm text-slate-500">Choose a consultant to open that service's transcript.</p>}{specialty && threadMessages.length === 0 && <p className="text-sm text-slate-500">No messages in this {audience} {specialty} thread yet.</p>}{threadMessages.map((message, index) => <div key={`${index}-${message.content}`} className={`rounded-lg p-3 text-sm ${message.role === 'student' ? 'ml-8 bg-blue-50' : 'mr-8 bg-white shadow-sm'}`}><span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'Your message' : 'Consultant response'}</span>{message.content}</div>)}</div>
      {disposition === 'assumes_care' && <p className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900">The consultant has assumed care. Follow the case-ending instructions in the encounter.</p>}
      {error && <p role="alert" className="border-t bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
      <form onSubmit={send} className="border-t p-4"><label className="text-sm font-medium">Message<textarea value={draft.text} onChange={(e) => updateDraft(e.target.value)} rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Please send your message." disabled={!specialty || loading} required /></label><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Close</button><button type="submit" disabled={loading || !specialty || !draft.text.trim()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send</button></div></form>
    </div>
  </div>;
}
