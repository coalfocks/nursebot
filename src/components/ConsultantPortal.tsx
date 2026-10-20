import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ConsultantAudience, ConsultantService, CONSULTANT_DIRECTORY, CONSULTANT_DIRECTORY_BY_ID, searchConsultants } from '../lib/consultantDirectory';

type Props = { assignmentId: string; open: boolean; onClose: () => void };
export type ConsultantMessage = {
  id?: string;
  role: 'student' | 'consultant';
  content: string;
  serviceId?: string | null;
  serviceLabel?: string | null;
  audience?: ConsultantAudience | null;
  requestId?: string | null;
};
type ThreadKey = `${ConsultantAudience}:${string}`;
type Drafts = Record<string, string>;

const selectedServiceStorageKey = (assignmentId: string) => `consultant:selected:${assignmentId}`;
const threadKey = (service: ConsultantService) => `${service.audience}:${service.id}` as ThreadKey;

export function ConsultantPortal({ assignmentId, open, onClose }: Props) {
  const [audience, setAudience] = useState<ConsultantAudience | ''>('');
  const [serviceId, setServiceId] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Drafts>({});
  const [threads, setThreads] = useState<Record<string, ConsultantMessage[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const scopeEpoch = useRef(0);

  const selectedService = serviceId ? CONSULTANT_DIRECTORY_BY_ID.get(serviceId) : undefined;
  const visibleServices = useMemo(() => searchConsultants(audience, search), [audience, search]);
  const selectedThread = selectedService ? threads[threadKey(selectedService)] ?? [] : [];
  const draft = selectedService ? drafts[threadKey(selectedService)] ?? '' : '';

  useEffect(() => {
    if (!open) return;
    const epoch = ++scopeEpoch.current;
    setError(null); setDisposition(null); setLoadingHistory(true);
    setAudience(''); setServiceId(''); setSearch(''); setClientRequestId(null);
    void (async () => {
      const { data, error: loadError } = await (supabase as any).from('consultant_chat_messages')
        .select('id, role, content, service_id, service_label, audience, request_id')
        .eq('assignment_id', assignmentId).order('created_at').order('id');
      if (epoch !== scopeEpoch.current) return;
      if (loadError) setError(loadError.message);
      const grouped: Record<string, ConsultantMessage[]> = {};
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const id = typeof row.service_id === 'string' ? row.service_id : '';
        const rowAudience = row.audience === 'adult' || row.audience === 'pediatric' ? row.audience : null;
        const key = rowAudience && id ? `${rowAudience}:${id}` : 'legacy';
        (grouped[key] ??= []).push({ id: String(row.id), role: row.role as ConsultantMessage['role'], content: String(row.content), serviceId: id || null, serviceLabel: typeof row.service_label === 'string' ? row.service_label : null, audience: rowAudience, requestId: typeof row.request_id === 'string' ? row.request_id : null });
      }
      setThreads(grouped);
      const saved = window.localStorage.getItem(selectedServiceStorageKey(assignmentId));
      const restored = saved ? CONSULTANT_DIRECTORY_BY_ID.get(saved) : undefined;
      if (restored && grouped[threadKey(restored)]) { setAudience(restored.audience); setServiceId(restored.id); }
      setLoadingHistory(false);
    })();
    return () => { scopeEpoch.current += 1; };
  }, [assignmentId, open]);

  const chooseService = (service: ConsultantService) => {
    scopeEpoch.current += 1;
    setLoading(false); setAudience(service.audience); setServiceId(service.id); setError(null); setDisposition(null); setClientRequestId(null);
    window.localStorage.setItem(selectedServiceStorageKey(assignmentId), service.id);
  };

  const chooseAudience = (nextAudience: ConsultantAudience | '') => {
    scopeEpoch.current += 1;
    setLoading(false); setAudience(nextAudience); setServiceId(''); setError(null); setDisposition(null); setClientRequestId(null);
  };

  const updateDraft = (value: string) => {
    if (!selectedService) return;
    const key = threadKey(selectedService);
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedService || loading || !draft.trim() || loadingHistory) return;
    const capturedEpoch = scopeEpoch.current;
    const capturedService = selectedService;
    const capturedDraft = draft.trim();
    const requestId = clientRequestId ?? crypto.randomUUID();
    setClientRequestId(requestId); setLoading(true); setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ message: string; disposition?: string; orderId?: string; requestId?: string; messages?: ConsultantMessage[] }>('consultant-chat', { body: { assignmentId, request: { serviceId: capturedService.id, serviceLabel: capturedService.label, audience: capturedService.audience, message: capturedDraft, clientRequestId: requestId } } });
      if (invokeError) throw invokeError;
      if (capturedEpoch !== scopeEpoch.current || serviceId !== capturedService.id || audience !== capturedService.audience) return;
      if (!data?.message) throw new Error('Consultant response missing');
      const key = threadKey(capturedService);
      const returned = data.messages?.length ? data.messages : [
        { role: 'student' as const, content: capturedDraft, serviceId: capturedService.id, serviceLabel: capturedService.label, audience: capturedService.audience, requestId: data.requestId ?? requestId },
        { role: 'consultant' as const, content: data.message, serviceId: capturedService.id, serviceLabel: capturedService.label, audience: capturedService.audience, requestId: data.requestId ?? requestId },
      ];
      setThreads((current) => ({ ...current, [key]: [...(current[key] ?? []), ...returned] }));
      setDrafts((current) => ({ ...current, [key]: '' })); setDisposition(data.disposition ?? null); setClientRequestId(null);
    } catch (cause) {
      if (capturedEpoch !== scopeEpoch.current) return;
      let message = cause instanceof Error ? cause.message : 'Consultant request failed';
      const context = (cause as { context?: Response }).context;
      if (context?.json) { try { const body = await context.clone().json() as { error?: string; message?: string }; message = body.error || body.message || message; } catch { /* preserve original */ } }
      setError(message);
    } finally { if (capturedEpoch === scopeEpoch.current) setLoading(false); }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultant-portal-title">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-4"><div><h2 id="consultant-portal-title" className="text-lg font-semibold">Consultant Portal</h2><p className="text-xs text-slate-500">Choose an audience and consultant, then send your question.</p></div><button type="button" onClick={onClose} aria-label="Close consultant portal"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-3 border-b p-4 sm:grid-cols-[9rem_1fr]">
        <label className="text-sm font-medium">Audience<select value={audience} onChange={(e) => chooseAudience(e.target.value as ConsultantAudience | '')} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consultant audience"><option value="">Choose</option><option value="adult">Adult</option><option value="pediatric">Pediatric</option></select></label>
        <label className="text-sm font-medium">Consultant<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Search consultants or aliases…" aria-label="Search consultants" /><select value={serviceId} onChange={(e) => { const service = CONSULTANT_DIRECTORY_BY_ID.get(e.target.value); if (service) chooseService(service); }} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" aria-label="Consultant service"><option value="">Choose a consultant</option>{(['adult', 'pediatric'] as ConsultantAudience[]).map((group) => <optgroup key={group} label={group === 'adult' ? 'Adult services' : 'Pediatric services'}>{visibleServices.filter((item) => item.audience === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      </div>
      {selectedService && <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-2 text-sm text-blue-950"><span>Selected consultant: <strong>{selectedService.label}</strong> · {selectedService.audience === 'adult' ? 'Adult' : 'Pediatric'}</span>{loadingHistory && <span className="text-xs">Loading history…</span>}</div>}
      <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">{!selectedService && <p className="text-sm text-slate-500">Choose a consultant to view its conversation.</p>}{selectedService && selectedThread.length === 0 && !loadingHistory && <p className="text-sm text-slate-500">No messages for this consultant yet.</p>}{selectedThread.map((message, index) => <div key={message.id ?? `${index}-${message.content}`} className={`rounded-lg p-3 text-sm ${message.role === 'student' ? 'ml-8 bg-blue-50' : 'mr-8 bg-white shadow-sm'}`}><span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'Your message' : `${selectedService.label} response`}</span>{message.content}</div>)}</div>
      {disposition === 'assumes_care' && <p className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900">The consultant has assumed care. Follow the authored encounter instructions.</p>}
      {error && <p role="alert" className="border-t bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
      {selectedService && <form onSubmit={send} className="border-t p-4"><label className="block text-sm font-medium">Message<textarea value={draft} onChange={(e) => updateDraft(e.target.value)} rows={3} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="Please send your message." aria-label="Consultant message" /></label><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-3 py-2 text-sm">Close</button><button type="submit" disabled={loading || loadingHistory || !draft.trim()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send</button></div></form>}
    </div>
  </div>;
}

export { CONSULTANT_DIRECTORY };
