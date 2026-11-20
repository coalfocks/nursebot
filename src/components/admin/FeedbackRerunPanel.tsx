import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  PROMOTE_CONFIRMATION,
  buildComparison,
  listFeedbackRerunVersions,
  promoteFeedbackRerun,
  sideFromAssignment,
  sideFromVersion,
  startFeedbackRerun,
  type FeedbackJson,
  type FeedbackRerunVersion,
} from '../../lib/feedbackRerun';

type Props = { assignment: FeedbackJson; onPromoted?: () => void };

/** Compare-only by default: rerunning never changes the saved result. Promote is separate and confirmed. */
export function FeedbackRerunPanel({ assignment, onPromoted }: Props) {
  const [versions, setVersions] = useState<FeedbackRerunVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await listFeedbackRerunVersions(assignment.id);
      setVersions(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load reruns');
    }
  }, [assignment.id]);

  useEffect(() => { void load(); }, [load]);
  const anyRunning = versions.some((version) => version.status === 'running');
  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  if (assignment.status !== 'completed') return null;
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const comparison = selected?.status === 'completed' ? buildComparison(sideFromAssignment(assignment), sideFromVersion(selected)) : null;

  const rerun = async () => {
    setBusy(true); setError(null);
    try { const id = await startFeedbackRerun(assignment.id); setSelectedId(id); await load(); }
    catch (rerunError) { setError(rerunError instanceof Error ? rerunError.message : 'Rerun failed'); }
    finally { setBusy(false); }
  };

  const promote = async () => {
    if (!selected) return;
    setPromoting(true); setError(null);
    try { await promoteFeedbackRerun(assignment.id, selected.id, confirmText); setConfirmText(''); await load(); onPromoted?.(); }
    catch (promoteError) { setError(promoteError instanceof Error ? promoteError.message : 'Promote failed'); }
    finally { setPromoting(false); }
  };

  return (
    <div className="mt-4 rounded-md border border-gray-200 p-4" data-testid="feedback-rerun-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Rerun with current evaluator (compare only)</h4>
          <p className="text-xs text-gray-500">Stored as a new version. The saved grade and feedback are not changed.</p>
        </div>
        <button type="button" onClick={() => void rerun()} disabled={busy || anyRunning} className="inline-flex items-center rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {busy || anyRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          Rerun for comparison
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {versions.length > 0 && (
        <select value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="mt-3 block w-full rounded-md border-gray-300 text-sm" aria-label="Rerun version">
          {versions.map((version) => (
            <option key={version.id} value={version.id}>{new Date(version.created_at).toLocaleString()} - {version.status}{version.promoted_at ? ' (promoted)' : ''}</option>
          ))}
        </select>
      )}
      {selected?.status === 'running' && <p className="mt-3 text-sm text-gray-600">Rerun in progress…</p>}
      {selected?.status === 'failed' && <p className="mt-3 text-sm text-red-600">Rerun failed: {selected.error ?? 'unknown error'}. The saved result is unchanged.</p>}
      {comparison && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Saved (official)</th><th className="py-1">Rerun</th></tr></thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.label} className={row.changed ? 'bg-amber-50' : ''}>
                  <td className="py-1 pr-3 align-top font-medium text-gray-700">{row.label}</td>
                  <td className="py-1 pr-3 align-top break-all text-gray-700">{row.saved}</td>
                  <td className="py-1 align-top break-all text-gray-700">{row.rerun}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!selected?.promoted_at && (
            <div className="mt-3 flex items-center gap-2">
              <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder={`Type ${PROMOTE_CONFIRMATION} to enable`} className="rounded-md border-gray-300 text-sm" aria-label="Promote confirmation" />
              <button type="button" onClick={() => void promote()} disabled={promoting || confirmText !== PROMOTE_CONFIRMATION} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40">
                {promoting ? 'Promoting…' : 'Promote to official result'}
              </button>
            </div>
          )}
          {selected?.promoted_at && <p className="mt-3 text-xs text-gray-500">Promoted {new Date(selected.promoted_at).toLocaleString()}. The replaced result is kept in promotion_backup.</p>}
        </div>
      )}
    </div>
  );
}
