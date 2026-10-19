import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CONSULTANT_TRANSPORT_FUNCTION_VERSION, preflightConsultantTransport } from '../lib/consultantTransport';
import { CONSULTANT_DIRECTORY, filterConsultantMessages, getConsultantThreadKey } from './consultantPortalModel';
import type { Audience, Message } from './consultantPortalModel';

type Props = { assignmentId: string; open: boolean; onClose: () => void };
type Draft = { text: string; clientRequestId: string | null };
type ThreadStatus = { loading: boolean; error: string | null; disposition: string | null };
type GateState = { status: 'idle' | 'checking' | 'ready' | 'blocked'; reason?: string };
type MessageQuery = {
  select: (columns: string) => MessageQuery;
  eq: (column: string, value: string) => MessageQuery;
  order: (column: string, options?: { ascending?: boolean }) => MessageQuery;
  then: (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) => Promise<unknown>;
};

const emptyDraft = (): Draft => ({ text: '', clientRequestId: null });
const emptyThreadStatus = (): ThreadStatus => ({ loading: false, error: null, disposition: null });

const getErrorMessage = async (cause: unknown) => {
  let message = cause instanceof Error ? cause.message : 'Consultant request failed';
  const context = (cause as { context?: Response }).context;
  if (context?.json) {
    try {
      const body = await context.clone().json() as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch { /* retain the transport error */ }
  }
  return message;
};

const mergeStoredMessages = (current: Message[], stored: Message[]) => {
  const byId = new Map(current.map((message) => [message.id, message]));
  stored.forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((left, right) => (left.created_at ?? '').localeCompare(right.created_at ?? '') || left.id.localeCompare(right.id));
};

export function ConsultantPortal({ assignmentId, open, onClose }: Props) {
  const [audience, setAudience] = useState<Audience>('adult');
  const [specialty, setSpecialty] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [legacyMessages, setLegacyMessages] = useState<Message[]>([]);
  const [historyErrors, setHistoryErrors] = useState<Record<string, string | null>>({});
  const [threadStatuses, setThreadStatuses] = useState<Record<string, ThreadStatus>>({});
  const [gate, setGate] = useState<GateState>({ status: 'idle' });
  const currentAssignmentRef = useRef(assignmentId);
  currentAssignmentRef.current = assignmentId;

  const filteredSpecialties = useMemo(() => CONSULTANT_DIRECTORY.filter((item) => (item.audiences as readonly Audience[]).includes(audience) && `${item.label} ${item.value}`.toLowerCase().includes(search.trim().toLowerCase())), [audience, search]);
  const threadKey = getConsultantThreadKey(assignmentId, audience, specialty);
  const draft = drafts[threadKey] ?? emptyDraft();
  const threadStatus = threadStatuses[threadKey] ?? emptyThreadStatus();
  const threadMessages = filterConsultantMessages(messages, audience, specialty);

  useEffect(() => {
    if (!open) {
      setGate({ status: 'idle' });
      return;
    }
    let active = true;
    setGate({ status: 'checking' });
    setMessages([]);
    setLegacyMessages([]);
    setHistoryErrors((current) => ({ ...current, [assignmentId]: null }));
    void (async () => {
      try {
        const result = await preflightConsultantTransport(supabase as unknown as Parameters<typeof preflightConsultantTransport>[0]);
        if (!active) return;
        if (!result.ready) {
          setGate({ status: 'blocked', reason: result.reason });
          return;
        }
        setGate({ status: 'ready' });
        const messageClient = supabase as unknown as { from: (table: string) => MessageQuery };
        const { data, error: loadError } = await messageClient.from('consultant_chat_messages')
          .select('id, role, content, specialty, audience, created_at, request_id, consult_order_id')
          .eq('assignment_id', assignmentId)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
        if (!active || currentAssignmentRef.current !== assignmentId) return;
        if (loadError) {
          setHistoryErrors((current) => ({ ...current, [assignmentId]: loadError.message }));
          return;
        }
        const loaded = (data ?? []) as Message[];
        setMessages(loaded.filter((message) => message.audience !== null));
        setLegacyMessages(loaded.filter((message) => message.audience === null));
      } catch {
        if (active) setGate({ status: 'blocked', reason: 'Consultant transport readiness could not be checked. Close and reopen the portal to retry.' });
      }
    })();
    return () => { active = false; };
  }, [assignmentId, audience, open]);

  const updateThreadStatus = (key: string, update: Partial<ThreadStatus>) => setThreadStatuses((current) => ({ ...current, [key]: { ...(current[key] ?? emptyThreadStatus()), ...update } }));

  const chooseAudience = (next: Audience) => {
    setAudience(next);
    setSpecialty('');
    setSearch('');
  };

  const chooseSpecialty = (next: string) => {
    setSpecialty(next);
    setSearch('');
  };

  const updateDraft = (text: string) => {
    if (threadStatus.loading || draft.clientRequestId) return;
    setDrafts((current) => ({ ...current, [threadKey]: { ...(current[threadKey] ?? emptyDraft()), text } }));
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (gate.status !== 'ready' || threadStatus.loading || !specialty || !draft.text.trim()) return;
    const captured = {
      assignmentId,
      audience,
      specialty,
      message: draft.text,
      clientRequestId: draft.clientRequestId ?? crypto.randomUUID(),
      threadKey,
    };
    setDrafts((current) => ({ ...current, [captured.threadKey]: { text: captured.message, clientRequestId: captured.clientRequestId } }));
    updateThreadStatus(captured.threadKey, { loading: true, error: null });
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        message: string;
        messages?: Message[];
        disposition?: string;
        orderId?: string;
      }>('consultant-chat', {
        body: {
          transportContractVersion: CONSULTANT_TRANSPORT_FUNCTION_VERSION,
          assignmentId: captured.assignmentId,
          request: {
            audience: captured.audience,
            specialty: captured.specialty,
            message: captured.message,
            clientRequestId: captured.clientRequestId,
          },
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.message || !Array.isArray(data.messages) || data.messages.length === 0) throw new Error('Consultant response did not include stored messages');
      if (currentAssignmentRef.current === captured.assignmentId) setMessages((current) => mergeStoredMessages(current, data.messages ?? []));
      updateThreadStatus(captured.threadKey, { loading: false, error: null, disposition: data.disposition ?? null });
      setDrafts((current) => ({ ...current, [captured.threadKey]: emptyDraft() }));
    } catch (cause) {
      updateThreadStatus(captured.threadKey, { loading: false, error: await getErrorMessage(cause) });
    } finally {
      updateThreadStatus(captured.threadKey, { loading: false });
    }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultant-portal-title">
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-4"><div><h2 id="consultant-portal-title" className="text-lg font-semibold">Consultant Portal</h2><p className="text-xs text-slate-500">Choose the patient population and consultant before sending a message.</p></div><button type="button" onClick={onClose} aria-label="Close consultant portal"><X className="h-5 w-5" /></button></div>
      {gate.status !== 'ready' && <div role="status" className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">{gate.status === 'checking' ? 'Checking consultant transport readiness…' : gate.reason ?? 'Consultant Portal is unavailable until the coordinated schema and function contract are ready.'}</div>}
      {gate.status === 'ready' && <>
        <div className="grid gap-3 border-b p-4">
          <fieldset><legend className="text-sm font-medium">Patient population</legend><div className="mt-1 flex gap-2" role="radiogroup" aria-label="Patient population"><button type="button" role="radio" aria-checked={audience === 'adult'} onClick={() => chooseAudience('adult')} className={`rounded-md border px-3 py-2 text-sm ${audience === 'adult' ? 'border-blue-600 bg-blue-50 text-blue-800' : ''}`}>Adult</button><button type="button" role="radio" aria-checked={audience === 'pediatric'} onClick={() => chooseAudience('pediatric')} className={`rounded-md border px-3 py-2 text-sm ${audience === 'pediatric' ? 'border-blue-600 bg-blue-50 text-blue-800' : ''}`}>Pediatric</button></div></fieldset>
          <label className="text-sm font-medium">Consultant service<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Search adult or pediatric consultants…" aria-label="Search consultant services" /><select value={specialty} onChange={(e) => chooseSpecialty(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consultant service"><option value="">Choose a consultant</option>{filteredSpecialties.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        {historyErrors[assignmentId] && <p role="alert" className="border-b bg-red-50 px-4 py-2 text-sm text-red-800">Transcript history could not be loaded: {historyErrors[assignmentId]}</p>}
        <div className="min-h-[180px] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">{!historyErrors[assignmentId] && !specialty && <p className="text-sm text-slate-500">Choose a consultant to open that service&apos;s transcript.</p>}{!historyErrors[assignmentId] && specialty && threadMessages.length === 0 && <p className="text-sm text-slate-500">No messages in this {audience} {specialty} thread yet.</p>}{threadMessages.map((message) => <div key={message.id} className={`rounded-lg p-3 text-sm ${message.role === 'student' ? 'ml-8 bg-blue-50' : 'mr-8 bg-white shadow-sm'}`}><span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'Your message' : 'Consultant response'}</span>{message.content}</div>)}</div>
        {legacyMessages.length > 0 && <section className="border-t bg-slate-100 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">Legacy / unclassified transcript</h3><p className="text-xs text-slate-600">Read-only legacy messages with no audience. They are not assigned to this current service thread.</p><div className="mt-2 space-y-2">{legacyMessages.map((message) => <div key={message.id} className="rounded border bg-white p-2 text-sm"><span className="mr-2 text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'Legacy request' : 'Legacy response'}</span>{message.content}</div>)}</div></section>}
        {threadStatus.disposition === 'assumes_care' && <p className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900">Consultant handoff plan: review the consultant response and follow the authored encounter instructions. This does not complete the case automatically.</p>}
        {threadStatus.error && <p role="alert" className="border-t bg-red-50 px-4 py-2 text-sm text-red-800">{threadStatus.error}</p>}
        <form onSubmit={send} className="border-t p-4"><label className="text-sm font-medium">Message<textarea value={draft.text} onChange={(e) => updateDraft(e.target.value)} rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Please send your message." disabled={!specialty || threadStatus.loading || Boolean(draft.clientRequestId)} required /></label><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Close</button><button type="submit" disabled={threadStatus.loading || !specialty || !draft.text.trim()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{threadStatus.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{draft.clientRequestId ? 'Retry' : 'Send'}</button></div></form>
      </>}
    </div>
  </div>;
}
