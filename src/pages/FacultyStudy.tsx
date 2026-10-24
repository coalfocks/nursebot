import { useState } from 'react';
import { AlertCircle, Download, FileCheck2, LockKeyhole, Play, ShieldCheck } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';

const download = (name: string, body: string, type: string) => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
};

const formatInvokeError = async (value: unknown) => {
  const candidate = value as { context?: Response; message?: string } | null;
  const response = candidate?.context instanceof Response ? candidate.context : null;
  let payload: { error?: { code?: string; message?: string; request_id?: string } } | null = null;
  if (response) {
    try { payload = await response.clone().json() as typeof payload; } catch { /* preserve the SDK message */ }
  }
  const detail = payload?.error;
  const code = detail?.code ?? candidate?.message ?? 'FACULTY_STUDY_REQUEST_FAILED';
  const message = detail?.message && detail.message !== code ? `: ${detail.message}` : '';
  const requestId = detail?.request_id ? ` (request ${detail.request_id})` : '';
  return `${response ? `HTTP ${response.status} · ` : ''}${code}${message}${requestId}`;
};

export default function FacultyStudy() {
  const [manifestText, setManifestText] = useState('');
  const [batchId, setBatchId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preflightOnly, setPreflightOnly] = useState(false);

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.functions.invoke('faculty-study-feedback', { body: { action, ...extra } });
      if (result.error) throw result.error;
      if (result.data?.error) throw new Error(`${result.data.error.code}: ${result.data.error.message}`);
      return result.data;
    } catch (value) { setError(await formatInvokeError(value)); return null; }
    finally { setBusy(false); }
  };

  const parseManifest = () => {
    try { return JSON.parse(manifestText) as Record<string, unknown>; }
    catch { throw new Error('Manifest must be valid JSON.'); }
  };

  const prepare = async () => {
    try {
      const data = await invoke('prepare', { manifest: parseManifest() });
      if (data?.batch?.id) { setBatchId(data.batch.id); setNotice(`Prepared ${data.batch.batch_key}. No learner rows were written. Review the frozen prompt/config/model attestation before running.`); }
    } catch (value) { setError(value instanceof Error ? value.message : 'Invalid manifest.'); }
  };

  const preflight = async () => {
    try {
      const data = await invoke('preflight', { manifest: parseManifest() });
      if (!data) return;
      download(`${data.batch_key}.model-free-preflight.json`, JSON.stringify(data, null, 2), 'application/json');
      setPreflightOnly(data.deployment_mode === 'preflight-only');
      const ready = data.readiness?.ready;
      const found = data.feedback_backup_readiness?.found_count ?? 0;
      const errors = data.feedback_backup_readiness?.error_count ?? 0;
      setNotice(`Model-free preflight exported ${found}/30 raw feedback backups (${errors} errors). Readiness: ${ready ? 'ready' : 'blocked; review the returned schema/config/model evidence'}. Deployment mode: ${data.deployment_mode}. No model or learner write occurred.`);
    } catch (value) { setError(value instanceof Error ? value.message : 'Invalid manifest.'); }
  };

  const audit = async () => {
    try {
      const data = await invoke('audit', { manifest: parseManifest() });
      if (!data) return;
      download(`${data.batch_key}.historical-input-audit.json`, JSON.stringify(data, null, 2), 'application/json');
      setPreflightOnly(data.deployment_mode === 'preflight-only');
      setNotice(`Historical input audit exported ${data.audited_count}/${data.attempt_count} attempts (${data.error_count} errors). Model calls: ${data.model_calls}; learner/study writes: ${data.learner_writes}/${data.study_writes}.`);
    } catch (value) { setError(value instanceof Error ? value.message : 'Invalid manifest.'); }
  };

  const run = async () => { const data = await invoke('run', { batch_id: batchId }); if (data) setNotice(`Study complete: ${data.result_writes} isolated result rows; learner writes: ${data.learner_writes}.`); };
  const exportBatch = async () => {
    const data = await invoke('export', { batch_id: batchId });
    if (!data) return;
    download(`${batchId}.raw.json`, JSON.stringify(data.raw, null, 2), 'application/json');
    download(`${batchId}.sheet.csv`, data.sheet, 'text/csv');
    for (const document of data.documents ?? []) download(document.filename, document.content, 'application/json');
    download(`${batchId}.coordinator.private.json`, JSON.stringify(data.coordinator ?? [], null, 2), 'application/json');
    setNotice(`Exported reviewer JSON, sheet, ${data.documents?.length ?? 0} deidentified documents, and the private coordinator export.`);
  };

  return <AdminLayout><main className="mx-auto max-w-5xl space-y-6 p-6">
    <header><p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Superadmin · isolated study</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Faculty feedback rerun</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">This route accepts a private fixed manifest and provides a model-free historical-input audit before any isolated study write. It never calls the learner feedback generator and never updates assignments, grades, history, or statuses.</p></header>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border bg-white p-3 text-sm"><LockKeyhole className="mb-2 h-4 w-4 text-blue-700" />Authenticated superadmin only</div><div className="rounded border bg-white p-3 text-sm"><ShieldCheck className="mb-2 h-4 w-4 text-emerald-700" />Frozen prompt/config/model attestation</div><div className="rounded border bg-white p-3 text-sm"><FileCheck2 className="mb-2 h-4 w-4 text-violet-700" />Case 1–30 and explicit errors</div></div>
    {notice && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
    {error && <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertCircle className="mt-0.5 h-4 w-4" />{error}</div>}
    <section className="rounded-lg border bg-white p-5 shadow-sm"><label className="font-semibold text-slate-900" htmlFor="study-manifest">Fixed manifest JSON</label><p className="mt-1 text-xs text-slate-500">Keep this private until this authenticated route is approved. The service validates 30 unique assignments in batch-ordinal order while preserving each specialty, original Case 1–5 label, and packet label.</p><textarea id="study-manifest" value={manifestText} onChange={(event) => setManifestText(event.target.value)} rows={18} className="mt-4 w-full rounded border p-3 font-mono text-xs" placeholder="{ batch_key, prompt_version, prompt_text, expected_model, attempts: [{ batch_ordinal: 1, specialty: 'ED', case_label: 'Case 1', packet_label: 'Packet 1', assignment_id: ... }] }" /><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !manifestText} onClick={() => void preflight()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Export backups + readiness</button><button type="button" disabled={busy || !manifestText} onClick={() => void audit()} className="inline-flex items-center gap-2 rounded border border-violet-300 px-4 py-2 text-sm text-violet-800 disabled:opacity-50"><FileCheck2 className="h-4 w-4" />Audit historical inputs</button><button type="button" disabled={busy || !manifestText || preflightOnly} onClick={() => void prepare()} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{preflightOnly ? 'Prepare disabled (preflight-only)' : 'Prepare and attest'}</button><input aria-label="Prepared batch ID" value={batchId} onChange={(event) => setBatchId(event.target.value)} placeholder="Prepared batch ID" className="min-w-72 rounded border px-3 py-2 text-sm" /></div></section>
    <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Execution and export</h2><p className="mt-1 text-xs text-slate-500">Preparation must succeed before execution. Results are separate study records; failed attempts remain explicit error records.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !batchId || preflightOnly} onClick={() => void run()} className="inline-flex items-center gap-2 rounded bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{preflightOnly ? 'Run disabled (preflight-only)' : 'Run isolated study'}</button><button type="button" disabled={busy || !batchId} onClick={() => void exportBatch()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export artifacts</button></div></section>
  </main></AdminLayout>;
}
