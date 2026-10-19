import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, History, Save } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';

type Config = {
  id: string;
  scope: 'global' | 'room';
  room_id: number | null;
  version: number;
  status: 'draft' | 'active' | 'archived';
  evaluator_prompt: string;
  scoring_anchors: Record<string, unknown>;
  created_at: string;
};
type Room = { id: number; room_number: string; expected_diagnosis?: string | null };
const ANCHOR_KEYS = [
  'focused_information_gathering',
  'closed_loop_team_communication',
  'efficiency_deduction',
  'orders_monitoring_quality',
  'clinical_reasoning_documentation',
  'safety_deduction',
] as const;

// The generated database types predate this additive migration.
// Keep the narrow adapter local until generated types are refreshed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const configsTable = () => supabase.from('feedback_evaluator_configs' as never) as any;

export default function FeedbackStudio() {
  const [scope, setScope] = useState<'global' | 'room'>('global');
  const [roomId, setRoomId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [prompt, setPrompt] = useState('');
  const [anchors, setAnchors] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { prompt: string; anchors: string }>>({});
  const draftKey = scope === 'global' ? 'global' : `room:${roomId || 'unselected'}`;

  const visibleConfigs = useMemo(
    () => configs.filter((item) => item.scope === scope && (scope === 'global' || item.room_id === Number(roomId))),
    [configs, roomId, scope],
  );
  const selected = visibleConfigs.find((item) => item.id === selectedId)
    ?? visibleConfigs.find((item) => item.status === 'active')
    ?? visibleConfigs[0];

  const load = async () => {
    setError('');
    const [roomResult, configResult] = await Promise.all([
      supabase.from('rooms').select('id, room_number, expected_diagnosis').order('room_number'),
      configsTable().select('*').order('version', { ascending: false }),
    ]);
    if (roomResult.error) setError(roomResult.error.message);
    else setRooms((roomResult.data ?? []) as Room[]);
    if (configResult.error) setError(configResult.error.message);
    else setConfigs((configResult.data ?? []) as Config[]);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setPrompt(selected.evaluator_prompt ?? '');
    setAnchors(JSON.stringify(selected.scoring_anchors ?? {}, null, 2));
  }, [selected?.id]);
  useEffect(() => {
    if (selected) return;
    setSelectedId('');
    setPrompt(drafts[draftKey]?.prompt ?? '');
    setAnchors(drafts[draftKey]?.anchors ?? '');
    setPreview(null);
  }, [draftKey, selected?.id, drafts]);

  const rememberDraft = (nextPrompt: string, nextAnchors: string) => {
    setDrafts((current) => ({ ...current, [draftKey]: { prompt: nextPrompt, anchors: nextAnchors } }));
  };

  const parseAnchors = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(anchors); } catch { throw new Error('Scoring anchors must be valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Scoring anchors must be a JSON object.');
    const missing = ANCHOR_KEYS.filter((key) => {
      const value = (parsed as Record<string, unknown>)[key];
      return value == null || (typeof value === 'string' && !value.trim()) || (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value)));
    });
    if (missing.length) throw new Error(`Scoring anchors are missing the six-component contract: ${missing.join(', ')}.`);
    if (!prompt.trim()) throw new Error('Evaluator prompt cannot be empty.');
    return parsed as Record<string, unknown>;
  };

  const saveDraft = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc('create_feedback_evaluator_draft' as never, {
        p_scope: scope,
        p_room_id: scope === 'room' ? Number(roomId) : null,
        p_evaluator_prompt: prompt.trim(),
        p_scoring_anchors: parseAnchors(),
      } as never);
      if (result.error) throw result.error;
      setNotice(`Saved draft version ${result.data.version}. Activate it only after synthetic preview.`);
      await load();
      setSelectedId(result.data.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not save evaluator draft.');
    } finally { setSaving(false); }
  };

  const activate = async (configId: string) => {
    setSaving(true); setError(''); setNotice('');
    const result = await supabase.rpc('activate_feedback_evaluator_config' as never, { p_config_id: configId } as never);
    if (result.error) setError(result.error.message);
    else { setNotice('Evaluator version activated. New feedback runs will pin this version.'); await load(); }
    setSaving(false);
  };

  return (
    <AdminLayout>
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Superadmin</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Feedback Studio</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">Author and pin evaluator instructions and scoring anchors independently from clinical room prompts. Saving or activating this configuration never changes an assignment status or learner record.</p>
        </header>
        {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" />{notice}</div>}
        {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertCircle className="h-4 w-4" />{error}</div>}
        <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
            <div><label className="text-sm font-medium">Override scope</label><select className="mt-1 w-full rounded border px-3 py-2 text-sm" value={scope} onChange={(event) => { setScope(event.target.value as 'global' | 'room'); setSelectedId(''); }}><option value="global">Global evaluator</option><option value="room">Room override</option></select></div>
            {scope === 'room' && <div><label className="text-sm font-medium">Room</label><select className="mt-1 w-full rounded border px-3 py-2 text-sm" value={roomId} onChange={(event) => { setRoomId(event.target.value); setSelectedId(''); }}><option value="">Select a room…</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.room_number}{room.expected_diagnosis ? ` · ${room.expected_diagnosis}` : ''}</option>)}</select></div>}
            <div className="border-t pt-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />Versions</h2><div className="mt-2 space-y-2">{visibleConfigs.length === 0 ? <p className="text-xs text-slate-500">No saved versions.</p> : visibleConfigs.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded border p-2 text-left text-xs ${selected?.id === item.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}><span className="font-semibold">v{item.version}</span><span className="ml-2 uppercase text-slate-500">{item.status}</span><span className="mt-1 block text-slate-500">{new Date(item.created_at).toLocaleString()}</span></button>)}</div></div>
          </aside>
          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-900">Evaluator prompt</h2><p className="mt-1 text-xs text-slate-500">Codex supplies the evaluator text. This field is separate from patient/consultant room prompts.</p></div>{selected && <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">Current selection v{selected.version} · {selected.status}</span>}</div><textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); rememberDraft(event.target.value, anchors); }} rows={12} className="mt-4 w-full rounded border p-3 font-mono text-sm" placeholder="Paste the evaluator instructions here…" /></section>
            <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Scoring anchors</h2><p className="mt-1 text-xs text-slate-500">Keep the six component ranges and anchor language here as JSON for exact versioned read-back.</p><textarea value={anchors} onChange={(event) => { setAnchors(event.target.value); rememberDraft(prompt, event.target.value); }} rows={12} className="mt-4 w-full rounded border p-3 font-mono text-sm" placeholder="{ &quot;focused_information_gathering&quot;: { ... } }" /></section>
            <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={() => { try { const parsed = parseAnchors(); setPreview({ fixture: 'synthetic-evaluator-input-v1', prompt: prompt.trim(), scoring_anchors: parsed, evidence: ['synthetic.patient-message.1', 'synthetic.order.1', 'synthetic.progress-note.1'] }); setNotice('Synthetic preview valid: prompt and all six anchors are ready to pin.'); setError(''); } catch (value) { setError(value instanceof Error ? value.message : 'Invalid evaluator configuration.'); } }} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm"><Eye className="h-4 w-4" />Synthetic preview</button><button type="button" disabled={saving || (scope === 'room' && !roomId)} onClick={() => void saveDraft()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm disabled:opacity-50"><Save className="h-4 w-4" />Save new version</button>{selected && selected.status !== 'active' && <button type="button" disabled={saving} onClick={() => void activate(selected.id)} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Pin v{selected.version}</button>}</div>
            {preview && <section className="rounded-lg border border-blue-200 bg-blue-50 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold text-blue-950">Preview of pinned evaluator input</h3><button type="button" className="text-xs text-blue-800 underline" onClick={() => setPreview(null)}>Close preview</button></div><p className="mt-3 whitespace-pre-wrap text-sm text-blue-950">{prompt || 'No evaluator prompt authored yet.'}</p><pre className="mt-3 overflow-x-auto rounded bg-white p-3 text-xs text-slate-700">{JSON.stringify(preview, null, 2)}</pre></section>}
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}
