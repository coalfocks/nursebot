/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { useAuthStore } from '../stores/authStore';

type Config = {
  id?: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  instructions: string;
  style: string;
  max_strengths: number;
  max_next_steps: number;
  communication_anchors: Record<string, string>;
  clinical_reasoning_anchors: Record<string, string>;
};

const blankConfig: Config = {
  version: 'feedback-contract-v1', status: 'draft', instructions: '', style: 'concise',
  max_strengths: 3, max_next_steps: 3,
  communication_anchors: { focused_information_gathering: '', closed_loop_team_communication: '', efficiency_deduction: 'Only deduct 0 to -2 for clearly repetitive or purposeless communication.' },
  clinical_reasoning_anchors: { orders_monitoring_quality: '', clinical_reasoning_documentation: '', safety_deduction: 'Only deduct 0 to -2 for a meaningful unsafe action or order.' },
};

const client = supabase as unknown as any;

export default function FeedbackStudio() {
  const { profile } = useAuthStore();
  const allowed = hasAdminAccess(profile) && isSuperAdmin(profile);
  const [config, setConfig] = useState<Config>(blankConfig);
  const [history, setHistory] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      const { data } = await client.from('feedback_studio_configs').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) setConfig(data as Config);
      const audit = await client.from('feedback_studio_audit').select('*').order('created_at', { ascending: false }).limit(20);
      setHistory(audit.data ?? []);
    })();
  }, [allowed]);

  if (!allowed) return <Navigate to="/dashboard" replace />;

  const save = async (publish: boolean) => {
    setBusy(true); setMessage('');
    const next = { ...config, status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null, created_by: profile?.id };
    const { data, error } = await client.from('feedback_studio_configs').upsert(next, { onConflict: 'version' }).select().single();
    if (error) setMessage(error.message);
    else {
      setConfig(data as Config);
      await client.from('feedback_studio_audit').insert({ config_id: data.id, action: publish ? 'published' : 'draft_saved', after_value: data, actor_id: profile?.id });
      setMessage(publish ? 'Published a new feedback configuration version.' : 'Saved draft.');
    }
    setBusy(false);
  };

  const rollback = async (entry: any) => {
    if (!entry?.after_value) return;
    setBusy(true); setMessage('');
    const restored = { ...entry.after_value, id: undefined, status: 'draft', version: `${entry.after_value.version ?? 'feedback-contract-v1'}-rollback-${Date.now()}`, created_by: profile?.id };
    const { data, error } = await client.from('feedback_studio_configs').insert(restored).select().single();
    if (error) setMessage(error.message);
    else {
      setConfig(data as Config);
      await client.from('feedback_studio_audit').insert({ config_id: data.id, action: 'rolled_back', before_value: config, after_value: data, actor_id: profile?.id });
      setHistory((current) => [{ id: data.id, action: 'rolled_back', created_at: new Date().toISOString(), after_value: data }, ...current]);
      setMessage('Rollback created a new draft version. Publish it explicitly when reviewed.');
    }
    setBusy(false);
  };

  const updateAnchor = (domain: 'communication_anchors' | 'clinical_reasoning_anchors', key: string, value: string) =>
    setConfig((current) => ({ ...current, [domain]: { ...current[domain], [key]: value } }));

  return <AdminLayout><main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
    <header><p className="text-sm font-medium text-blue-700">Superadmin authoring</p><h1 className="text-2xl font-bold text-slate-900">Feedback Studio</h1><p className="mt-1 text-sm text-slate-600">Edit structured instructions and anchors without changing the canonical six-component contract.</p></header>
    {message && <p role="status" className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    <section className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
      <div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-medium">Version<input value={config.version} onChange={(e) => setConfig({ ...config, version: e.target.value })} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm font-medium">Style<input value={config.style} onChange={(e) => setConfig({ ...config, style: e.target.value })} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm font-medium">Strengths / next steps<input type="number" min={1} max={5} value={config.max_strengths} onChange={(e) => setConfig({ ...config, max_strengths: Number(e.target.value), max_next_steps: Number(e.target.value) })} className="mt-1 w-full rounded border p-2" /></label></div>
      <label className="block text-sm font-medium">Global instructions<textarea value={config.instructions} onChange={(e) => setConfig({ ...config, instructions: e.target.value })} rows={4} className="mt-1 w-full rounded border p-2" placeholder="Evidence, length, and display rules" /></label>
      <div className="grid gap-4 md:grid-cols-2"><fieldset className="space-y-2 rounded border p-3"><legend className="px-1 text-sm font-semibold">Communication anchors</legend>{Object.entries(config.communication_anchors).map(([key, value]) => <label key={key} className="block text-xs font-medium">{key.replaceAll('_', ' ')}<textarea value={value} onChange={(e) => updateAnchor('communication_anchors', key, e.target.value)} rows={2} className="mt-1 w-full rounded border p-2 text-sm" /></label>)}</fieldset><fieldset className="space-y-2 rounded border p-3"><legend className="px-1 text-sm font-semibold">Clinical Reasoning anchors</legend>{Object.entries(config.clinical_reasoning_anchors).map(([key, value]) => <label key={key} className="block text-xs font-medium">{key.replaceAll('_', ' ')}<textarea value={value} onChange={(e) => updateAnchor('clinical_reasoning_anchors', key, e.target.value)} rows={2} className="mt-1 w-full rounded border p-2 text-sm" /></label>)}</fieldset></div>
      <div className="flex gap-2"><button disabled={busy} onClick={() => void save(false)} className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">Save draft</button><button disabled={busy} onClick={() => void save(true)} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">Publish version</button></div>
    </section>
    <section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Audit history / rollback</h2><p className="mt-1 text-xs text-slate-500">Rollback loads a prior value as a draft; publishing remains an explicit action.</p><div className="mt-3 space-y-2">{history.length ? history.map((entry) => <div key={entry.id} className="flex items-center justify-between rounded border p-3 text-sm"><span>{entry.action} · {new Date(entry.created_at).toLocaleString()}</span><button onClick={() => void rollback(entry)} className="rounded border px-3 py-1 text-blue-700">Load as draft</button></div>) : <p className="text-sm text-slate-600">No audited changes yet.</p>}</div></section>
  </main></AdminLayout>;
}
