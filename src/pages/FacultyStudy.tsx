import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, FileCheck2, Loader2, LockKeyhole, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';
import { useSearchParams } from 'react-router-dom';

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

type AuditAttempt = {
  batch_ordinal: number;
  specialty: string;
  case_label: string;
  packet_label: string;
  assignment_id: string;
  batch_id?: string;
  status: 'audited' | 'error';
  error?: { code?: string; message?: string };
};

type AuditResponse = {
  batch_key: string;
  manifest_sha256: string;
  deployment_mode: string;
  attempt_count: number;
  audited_count: number;
  error_count: number;
  results: AuditAttempt[];
};

type StudyHistoryResponse = {
  available: boolean;
  reason?: string;
  batches: Array<{ id: string; batch_key: string; status: string; prompt_version: string; model: string; created_at: string; completed_at: string | null; total_count: number; completed_count: number; error_count: number; pending_count: number; progress_status: string }>;
  versions: Array<{ batch_id: string; batch_key: string | null; batch_ordinal: number; status: string; downloadable: boolean; prompt_version: string; model: string; generated_at: string | null; created_at: string; batch_status: string | null }>;
};

type EvaluationState = 'idle' | 'running' | 'completed' | 'error';

export default function FacultyStudy() {
  const [searchParams] = useSearchParams();
  const selectedAssignmentId = searchParams.get('assignment_id');
  const [manifestText, setManifestText] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('faculty-study-approved-manifest') ?? '');
  const [batchId, setBatchId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preflightOnly, setPreflightOnly] = useState(false);
  const [deploymentKnown, setDeploymentKnown] = useState(false);
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [evaluationStates, setEvaluationStates] = useState<Record<number, EvaluationState>>({});
  const [evaluationErrors, setEvaluationErrors] = useState<Record<number, string>>({});
  const [evaluationBatches, setEvaluationBatches] = useState<Record<number, string>>({});
  const [auditIdentity, setAuditIdentity] = useState('');
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<StudyHistoryResponse | null>(null);

  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.functions.invoke('faculty-study-feedback', { body: { action, ...extra } });
      if (result.error) throw result.error;
      if (result.data?.error) throw new Error(`${result.data.error.code}: ${result.data.error.message}`);
      return result.data;
    } catch (value) { setError(await formatInvokeError(value)); return null; }
    finally { setBusy(false); }
  }, []);

  const parseManifest = () => {
    try { return JSON.parse(manifestText) as Record<string, unknown>; }
    catch { throw new Error('Manifest must be valid JSON.'); }
  };

  const loadHistory = useCallback(async (assignmentId: string) => {
    const data = await invoke('history', { assignment_id: assignmentId });
    if (!data) return;
    const history = data as StudyHistoryResponse;
    setHistoryData(history);
    setEvaluationStates((current) => ({ ...current, ...Object.fromEntries(history.versions.map((version) => [version.batch_ordinal, version.status === 'completed' ? 'completed' : version.status === 'error' ? 'error' : 'idle'])) }));
  }, [invoke]);

  useEffect(() => {
    if (selectedAssignmentId && !historyData) void loadHistory(selectedAssignmentId);
  }, [historyData, loadHistory, selectedAssignmentId]);

  const handleManifestChange = (value: string) => {
    setManifestText(value);
    setAuditData(null);
    setAuditIdentity('');
    setHistoryData(null);
    setSelectedOrdinal(null);
    setEvaluationBatches({});
    setEvaluationStates({});
    setEvaluationErrors({});
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
      setDeploymentKnown(true);
      const ready = data.readiness?.ready;
      const found = data.feedback_backup_readiness?.found_count ?? 0;
      const errors = data.feedback_backup_readiness?.error_count ?? 0;
      setNotice(`Model-free preflight exported ${found}/30 raw feedback backups (${errors} errors). Readiness: ${ready ? 'ready' : 'blocked; review the returned schema/config/model evidence'}. Deployment mode: ${data.deployment_mode}. No model or learner write occurred.`);
    } catch (value) { setError(value instanceof Error ? value.message : 'Invalid manifest.'); }
  };

  const audit = async () => {
    try {
      const manifest = parseManifest();
      const identity = JSON.stringify(manifest);
      const data = await invoke('audit', { manifest });
      if (!data) return;
      download(`${data.batch_key}.historical-input-audit.json`, JSON.stringify(data, null, 2), 'application/json');
      setPreflightOnly(data.deployment_mode === 'preflight-only');
      setDeploymentKnown(true);
      setAuditData(data as AuditResponse);
      setAuditIdentity(identity);
      window.localStorage.setItem('faculty-study-approved-manifest', JSON.stringify(manifest));
      const selected = (data.results ?? []).find((item: AuditAttempt) => item.assignment_id === selectedAssignmentId);
      setSelectedOrdinal(selected?.batch_ordinal ?? null);
      if (selectedAssignmentId) void loadHistory(selectedAssignmentId);
      setEvaluationStates(Object.fromEntries((data.results ?? []).map((item: AuditAttempt) => [item.batch_ordinal, 'idle'])));
      setNotice(`Historical input audit exported ${data.audited_count}/${data.attempt_count} attempts (${data.error_count} errors). Model calls: ${data.model_calls}; learner/study writes: ${data.learner_writes}/${data.study_writes}.`);
    } catch (value) { setError(value instanceof Error ? value.message : 'Invalid manifest.'); }
  };

  const exportRoomPdfs = async () => {
    const data = await invoke('export_room_pdfs');
    if (!data) return;
    download('room-pdfs-private-review-bundle.json', JSON.stringify({ manifest: data.manifest, files: data.files ?? [] }, null, 2), 'application/json');
    setNotice(`Exported one private bundle containing ${data.manifest?.object_count ?? 0} candidate room PDFs with server-computed SHA-256 hashes. Candidates remain unverified historical evidence; no model or database write occurred.`);
  };

  const downloadEvaluation = async (item: AuditAttempt) => {
    const batchIdForAttempt = item.batch_id ?? evaluationBatches[item.batch_ordinal];
    if (!batchIdForAttempt) return;
    const data = await invoke('export', { batch_id: batchIdForAttempt, batch_ordinal: item.batch_ordinal, assignment_id: item.assignment_id });
    if (!data) return;
    const result = data.raw?.results?.[0];
    for (const document of data.documents ?? []) download(document.filename, document.content, document.filename.endsWith('.html') ? 'text/html' : 'application/json');
    download(`${auditData?.batch_key ?? 'faculty-study'}-attempt-${String(item.batch_ordinal).padStart(2, '0')}.csv`, data.sheet, 'text/csv');
    setNotice(`Downloaded NEW-FORMAT evaluation for ordinal ${item.batch_ordinal}: ${result?.prompt_version ?? 'version unavailable'}${result?.generated_at ? ` · ${result.generated_at}` : ''}. No model call occurred during download.`);
  };

  const resumeBatch = async (batch: StudyHistoryResponse['batches'][number]) => {
    if (!deploymentKnown || preflightOnly || batch.progress_status === 'completed') return;
    const data = await invoke('run', { batch_id: batch.id });
    if (!data) return;
    setNotice(data.status === 'completed' ? `Study complete: ${data.progress?.completed_count ?? data.result_writes}/${data.progress?.total_count ?? batch.total_count} isolated results.` : `Study progress: ${data.progress?.completed_count ?? data.result_writes}/${data.progress?.total_count ?? batch.total_count} complete; ${data.progress?.error_count ?? 0} errors; ${data.progress?.remaining_count ?? 'some'} pending. No learner rows were written.`);
    if (selectedAssignmentId) void loadHistory(selectedAssignmentId);
  };

  const rerunEvaluation = async (item: AuditAttempt) => {
    if (!deploymentKnown || preflightOnly || evaluationStates[item.batch_ordinal] === 'running') return;
    if (!window.confirm(`Rerun evaluation for ${item.case_label} / ${item.packet_label}? This creates a separate isolated result and does not change learner feedback, grades, or history.`)) return;
    const ordinal = item.batch_ordinal;
    setEvaluationStates((current) => ({ ...current, [ordinal]: 'running' }));
    setEvaluationErrors((current) => ({ ...current, [ordinal]: '' }));
    try {
      const manifest = parseManifest();
      if (!auditIdentity || JSON.stringify(manifest) !== auditIdentity) throw new Error('STUDY_AUDIT_STALE: manifest changed; rerun the historical-input audit before starting an evaluation');
      const batchKey = `${String(manifest.batch_key ?? 'faculty-study').slice(0, 70)}-rerun-${ordinal}-${Date.now().toString(36)}`;
      const prepared = await invoke('prepare', { manifest: { ...manifest, batch_key: batchKey, target_ordinals: [ordinal] } });
      const isolatedBatchId = prepared?.batch?.id as string | undefined;
      if (!isolatedBatchId) throw new Error('STUDY_PREPARE_UNCONFIRMED');
      const runResult = await invoke('run', { batch_id: isolatedBatchId, max_cases: 1, target_ordinals: [ordinal] });
      if (!runResult) throw new Error('STUDY_RUN_UNCONFIRMED');
      const exported = await invoke('export', { batch_id: isolatedBatchId, batch_ordinal: ordinal });
      const result = exported?.raw?.results?.[0];
      if (!result || result.status === 'error') throw new Error(result?.error?.message ?? 'STUDY_RESULT_FAILED');
      setEvaluationBatches((current) => ({ ...current, [ordinal]: isolatedBatchId }));
      setEvaluationStates((current) => ({ ...current, [ordinal]: 'completed' }));
      void loadHistory(item.assignment_id);
      setNotice(`Evaluation ${ordinal} completed as an isolated NEW-FORMAT result. Prompt ${result.prompt_version ?? 'unknown'} · generated ${result.generated_at ?? 'timestamp unavailable'}. Learner records were not changed.`);
    } catch (value) {
      const text = value instanceof Error ? value.message : 'Rerun failed.';
      setEvaluationErrors((current) => ({ ...current, [ordinal]: text }));
      setEvaluationStates((current) => ({ ...current, [ordinal]: 'error' }));
    }
  };

  const run = async () => { const data = await invoke('run', { batch_id: batchId }); if (data) setNotice(data.status === 'completed' ? `Study complete: ${data.progress?.completed_count ?? data.result_writes}/${data.progress?.total_count ?? 30} isolated result rows.` : `Study progress: ${data.progress?.completed_count ?? data.result_writes}/${data.progress?.total_count ?? 30} complete; ${data.progress?.error_count ?? 0} errors; ${data.progress?.remaining_count ?? data.remaining ?? 'some'} pending. No learner rows were written.`); };
  const exportBatch = async () => {
    const data = await invoke('export', { batch_id: batchId });
    if (!data) return;
    download(`${batchId}.raw.json`, JSON.stringify(data.raw, null, 2), 'application/json');
    download(`${batchId}.sheet.csv`, data.sheet, 'text/csv');
    for (const document of data.documents ?? []) download(document.filename, document.content, document.filename.endsWith('.html') ? 'text/html' : 'application/json');
    download(`${batchId}.coordinator.private.json`, JSON.stringify(data.coordinator ?? [], null, 2), 'application/json');
    setNotice(`Exported reviewer JSON, sheet, ${data.documents?.length ?? 0} deidentified documents, and the private coordinator export.`);
  };

  return <AdminLayout><main className="mx-auto max-w-5xl space-y-6 p-6">
    <header><p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Superadmin · isolated study</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Faculty feedback rerun</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">This route accepts a private fixed manifest and provides a model-free historical-input audit before any isolated study write. It never calls the learner feedback generator and never updates assignments, grades, history, or statuses.</p></header>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border bg-white p-3 text-sm"><LockKeyhole className="mb-2 h-4 w-4 text-blue-700" />Authenticated superadmin only</div><div className="rounded border bg-white p-3 text-sm"><ShieldCheck className="mb-2 h-4 w-4 text-emerald-700" />Frozen prompt/config/model attestation</div><div className="rounded border bg-white p-3 text-sm"><FileCheck2 className="mb-2 h-4 w-4 text-violet-700" />Case 1–30 and explicit errors</div></div>
    {notice && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
    {error && <div role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertCircle className="mt-0.5 h-4 w-4" />{error}</div>}
    <section className="rounded-lg border bg-white p-5 shadow-sm"><label className="font-semibold text-slate-900" htmlFor="study-manifest">Approved fixed manifest JSON</label><p className="mt-1 text-xs text-slate-500">The approved manifest is retained only in this browser so the selected completed attempt can reopen without developer scripts. Editing it invalidates the audit and all selected-result controls. The service still validates 30 unique assignments in ordinal order.</p><textarea id="study-manifest" disabled={busy} value={manifestText} onChange={(event) => handleManifestChange(event.target.value)} rows={18} className="mt-4 w-full rounded border p-3 font-mono text-xs disabled:bg-slate-50" placeholder="Load the approved manifest privately, then audit the frozen 30." /><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !manifestText} onClick={() => void preflight()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Export backups + readiness</button><button type="button" disabled={busy || !manifestText} onClick={() => void audit()} className="inline-flex items-center gap-2 rounded border border-violet-300 px-4 py-2 text-sm text-violet-800 disabled:opacity-50"><FileCheck2 className="h-4 w-4" />Audit historical inputs</button><button type="button" disabled={busy} onClick={() => void exportRoomPdfs()} className="inline-flex items-center gap-2 rounded border border-amber-300 px-4 py-2 text-sm text-amber-900 disabled:opacity-50"><Download className="h-4 w-4" />Export candidate room PDF bundle</button><button type="button" disabled={busy || !manifestText || preflightOnly} onClick={() => void prepare()} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{preflightOnly ? 'Prepare disabled (preflight-only)' : 'Prepare and attest'}</button><input aria-label="Prepared batch ID" value={batchId} onChange={(event) => setBatchId(event.target.value)} placeholder="Prepared batch ID" className="min-w-72 rounded border px-3 py-2 text-sm" /></div></section>
    {historyData && <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Stored evaluation versions{selectedAssignmentId ? ` · ${selectedAssignmentId}` : ''}</h2><p className="mt-1 text-xs text-slate-500">Versions are discovered from the server by assignment and batch, so reloads do not lose completed downloads.</p>{!historyData.available && <p className="mt-3 text-sm text-amber-800">No study tables are available yet; stored-version discovery will resume after the reviewed study schema release.</p>}{historyData.available && historyData.batches.length === 0 && <p className="mt-3 text-sm text-slate-600">No isolated evaluation versions exist for this attempt yet.</p>}{historyData.batches.map((batch) => <div key={batch.id} className="mt-3 rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{batch.batch_key} · {batch.progress_status}</p><button type="button" disabled={busy || !deploymentKnown || preflightOnly || batch.progress_status === 'completed'} onClick={() => void resumeBatch(batch)} className="rounded border px-2 py-1 text-xs disabled:opacity-50">{preflightOnly || !deploymentKnown ? 'Resume unavailable (preflight-only)' : batch.progress_status === 'completed' ? 'Completed' : 'Resume evaluation'}</button></div><p className="text-xs text-slate-500">{batch.completed_count}/{batch.total_count} completed · {batch.error_count} errors · {batch.pending_count} pending · prompt {batch.prompt_version} · created {batch.created_at}</p>{historyData.versions.filter((version) => version.batch_id === batch.id).map((version) => <div key={`${version.batch_id}-${version.batch_ordinal}`} className="mt-2 flex items-center justify-between gap-3 text-sm"><span>Ordinal {version.batch_ordinal}: {version.status} {version.generated_at ? `· ${version.generated_at}` : ''}</span>{version.downloadable && <button type="button" disabled={busy} onClick={() => void downloadEvaluation({ batch_id: version.batch_id, batch_ordinal: version.batch_ordinal, specialty: '', case_label: '', packet_label: '', assignment_id: selectedAssignmentId ?? '', status: 'audited' })} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-50"><Download className="h-3 w-3" />Download evaluation</button>}</div>)}</div>)}</section>}
    {auditData && <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Audited attempts{selectedOrdinal ? ` · selected ordinal ${selectedOrdinal}` : ''}</h2><p className="mt-1 text-xs text-slate-500">Each rerun creates a separate isolated result. Existing learner feedback, grades, history, and prior evaluations are preserved. Downloads read the stored result and never call the model.</p><div className="mt-4 space-y-2">{auditData.results.map((item) => { const state = evaluationStates[item.batch_ordinal] ?? 'idle'; return <div key={item.batch_ordinal} className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 ${selectedOrdinal === item.batch_ordinal ? 'border-violet-400 bg-violet-50' : ''}`}><div><p className="font-medium text-slate-900">{item.batch_ordinal}. {item.specialty} · {item.case_label} · {item.packet_label}</p><p className="text-xs text-slate-500">{item.status === 'error' ? `Audit error: ${item.error?.message ?? 'unavailable'}` : state === 'completed' ? 'NEW-FORMAT evaluation ready' : state === 'running' ? 'Running isolated evaluation…' : 'Historical input audited; no evaluation generated yet.'}</p>{evaluationErrors[item.batch_ordinal] && <p className="text-xs text-red-700">{evaluationErrors[item.batch_ordinal]}</p>}</div><div className="flex gap-2"><button type="button" disabled={busy || item.status !== 'audited' || !deploymentKnown || preflightOnly || state === 'running' || !auditIdentity} onClick={() => void rerunEvaluation(item)} className="inline-flex items-center gap-2 rounded border border-orange-300 px-3 py-2 text-sm text-orange-800 disabled:opacity-50">{state === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{preflightOnly || !deploymentKnown ? 'Rerun unavailable (preflight-only)' : state === 'running' ? 'Rerunning…' : 'Rerun evaluation'}</button>{state === 'completed' && <button type="button" disabled={busy} onClick={() => void downloadEvaluation(item)} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Download evaluation</button>}</div></div>; })}</div></section>}
    <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Execution and export</h2><p className="mt-1 text-xs text-slate-500">Preparation must succeed before execution. Results are separate study records; failed attempts remain explicit error records.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !batchId || preflightOnly} onClick={() => void run()} className="inline-flex items-center gap-2 rounded bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{preflightOnly ? 'Run disabled (preflight-only)' : 'Run isolated study'}</button><button type="button" disabled={busy || !batchId} onClick={() => void exportBatch()} className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export artifacts</button></div></section>
  </main></AdminLayout>;
}
