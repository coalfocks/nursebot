import { useEffect, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ConsultantMessage = { role: 'student' | 'consultant'; content: string };

type ConsultantReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => Promise<{ data: ConsultantMessage[] | null; error: unknown | null }>;
      };
    };
  };
};

type ConsultantPortalProps = {
  assignmentId: string;
  open: boolean;
  onClose: () => void;
};

export function ConsultantPortal({ assignmentId, open, onClose }: ConsultantPortalProps) {
  const [messages, setMessages] = useState<ConsultantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const readClient = supabase as unknown as ConsultantReadClient;
      const { data, error: loadError } = await readClient
        .from('consultant_chat_messages')
        .select('role, content')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });
      if (!active) return;
      if (loadError) setError('Consultant conversation could not be loaded.');
      else setMessages((data ?? []).filter((message: ConsultantMessage) => message.content?.trim()));
    })();
    return () => { active = false; };
  }, [assignmentId, open]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    const next = [...messages, { role: 'student' as const, content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ message: string }>('consultant-chat', {
        body: { assignmentId, messages: next.map((message) => ({ role: message.role === 'student' ? 'user' : 'assistant', content: message.content })) },
      });
      if (invokeError) throw invokeError;
      if (!data?.message) throw new Error('Consultant response missing');
      setMessages((current) => [...current, { role: 'consultant', content: data.message }]);
    } catch (cause) {
      setMessages(messages);
      setInput(question);
      setError(cause instanceof Error ? cause.message : 'Consultant response failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="consultant-portal-title">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div><h2 id="consultant-portal-title" className="text-lg font-semibold">Consultant Portal</h2><p className="text-xs text-slate-500">Ask a focused clinical question. This channel is separate from Nurse Chat.</p></div>
          <button type="button" onClick={onClose} aria-label="Close consultant portal"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {messages.length === 0 && <p className="text-sm text-slate-500">No consultant questions yet.</p>}
          {messages.map((message, index) => <div key={`${index}-${message.content}`} className={`rounded-lg p-3 text-sm ${message.role === 'student' ? 'ml-8 bg-blue-50' : 'mr-8 bg-white shadow-sm'}`}><span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{message.role === 'student' ? 'You' : 'Consultant'}</span>{message.content}</div>)}
        </div>
        {error && <p role="alert" className="border-t bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
        <form onSubmit={send} className="flex gap-2 border-t p-4"><input value={input} onChange={(event) => setInput(event.target.value)} className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm" placeholder="Ask the consultant…" aria-label="Consultant question" /><button type="submit" disabled={loading || !input.trim()} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="sr-only">Send question</span></button></form>
      </div>
    </div>
  );
}
