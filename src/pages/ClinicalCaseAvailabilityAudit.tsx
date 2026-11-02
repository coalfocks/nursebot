import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess } from '../lib/roles';
import { supabase } from '../lib/supabase';
import {
  buildAuditRows,
  CLINICAL_ROOM_IDS,
  formatRawAvailability,
  isRestrictedCandidate,
  type ClinicalAuditRow,
  type RawClinicalRoom,
  type UpdateResult,
  updateClinicalAvailability,
} from '../lib/clinicalCaseAvailability';

const statusStyles: Record<ClinicalAuditRow['status'], string> = {
  global: 'bg-emerald-50 text-emerald-700',
  restricted: 'bg-amber-50 text-amber-700',
  malformed: 'bg-red-50 text-red-700',
  missing: 'bg-slate-100 text-slate-600',
};

const resultLabel = (result?: UpdateResult) => {
  if (!result) return null;
  if (result.kind === 'success') return 'Updated';
  if (result.kind === 'conflict') return 'Conflict — no retry';
  return `Error — ${result.message}`;
};

export default function ClinicalCaseAvailabilityAudit() {
  const { user, profile } = useAuthStore();
  const [rows, setRows] = useState<ClinicalAuditRow[]>([]);
  const [schools, setSchools] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [results, setResults] = useState<Record<number, UpdateResult>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults({});
    setSelectedIds([]);
    try {
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id,room_number,role,school_id,available_school_ids,updated_at')
        .in('id', [...CLINICAL_ROOM_IDS]);
      if (roomError) throw roomError;

      const rawRooms = (roomData ?? []) as RawClinicalRoom[];
      setRows(buildAuditRows(rawRooms));

      const schoolIds = [...new Set(rawRooms.map((room) => room.school_id).filter((id): id is string => Boolean(id)))];
      if (schoolIds.length === 0) {
        setSchools({});
      } else {
        const { data: schoolData, error: schoolError } = await supabase
          .from('schools')
          .select('id,name')
          .in('id', schoolIds);
        if (schoolError) throw schoolError;
        setSchools(Object.fromEntries((schoolData ?? []).map((school) => [school.id, school.name])));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load clinical room availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && hasAdminAccess(profile)) void loadAudit();
  }, [user, profile, loadAudit]);

  const candidates = useMemo(() => rows.filter(isRestrictedCandidate), [rows]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id) && isRestrictedCandidate(row)),
    [rows, selectedIds],
  );

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]);
  };

  const selectRestricted = () => {
    setSelectedIds(candidates.map((row) => row.id));
  };

  const applySelected = async () => {
    setConfirming(false);
    setWorking(true);
    try {
      for (const row of selectedRows) {
        let result: UpdateResult;
        try {
          result = await updateClinicalAvailability(supabase, row);
        } catch (updateError) {
          result = {
            kind: 'error',
            roomId: row.id,
            message: updateError instanceof Error ? updateError.message : 'Unexpected availability update failure.',
          };
        }
        setResults((current) => ({ ...current, [row.id]: result }));
      }
    } finally {
      setWorking(false);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!hasAdminAccess(profile)) return <Navigate to="/dashboard" replace />;

  return (
    <AdminLayout>
      <div className="space-y-6 px-6 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Admin audit / action</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Clinical Case Availability</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Source-reviewed scope: exactly {CLINICAL_ROOM_IDS.length} authoritative clinical room IDs. Protected rooms 102 and 118, plus every other room ID, are excluded.
              </p>
            </div>
            <button type="button" onClick={() => void loadAudit()} disabled={loading || working} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className="h-4 w-4" /> Refresh review
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">Scope: clinical rooms only</span>
            <span>Reads: six raw room fields + school labels</span>
            <span>Writes: availability only, guarded by updated_at</span>
          </div>
        </section>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">Review table</h2>
              <p className="text-sm text-slate-500">No rows are changed on load. Select restricted rows explicitly.</p>
            </div>
            <button type="button" onClick={selectRestricted} disabled={loading || candidates.length === 0 || working} className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              Select restricted clinical rows ({candidates.length})
            </button>
          </div>

          {confirming && selectedRows.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-4">
              <h3 className="font-semibold text-amber-900">Confirm availability reset</h3>
              <p className="mt-1 text-sm text-amber-800">This is the complete selected set. Each value below will change to [] only.</p>
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {selectedRows.map((row) => <li key={row.id}>Room {row.id}: {formatRawAvailability(row.original?.available_school_ids)} → []</li>)}
              </ul>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => void applySelected()} className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800">Confirm selected updates</button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">Cancel</button>
              </div>
            </div>
          )}

          {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div> : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3">Select</th><th className="px-5 py-3">Room</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Primary school</th><th className="px-5 py-3">Raw availability</th><th className="px-5 py-3">Updated at</th><th className="px-5 py-3">Status / result</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rows.map((row) => {
                    const result = results[row.id];
                    const disabled = !isRestrictedCandidate(row) || working || Boolean(result);
                    return <tr key={row.id} className="align-top">
                      <td className="px-5 py-4"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleSelected(row.id)} disabled={disabled} aria-label={`Select room ${row.id}`} /></td>
                      <td className="px-5 py-4 font-medium text-slate-900">{row.id}<div className="text-xs font-normal text-slate-500">#{row.room_number}</div></td>
                      <td className="px-5 py-4 text-slate-700">{row.role ?? '—'}</td>
                      <td className="px-5 py-4 text-slate-700"><div className="font-mono text-xs">{row.school_id ?? '—'}</div><div>{row.school_id ? schools[row.school_id] ?? 'Label unavailable' : '—'}</div></td>
                      <td className="max-w-xs break-all px-5 py-4 font-mono text-xs text-slate-700">{row.original ? formatRawAvailability(row.original.available_school_ids) : '—'}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-700">{row.updated_at ?? 'NULL'}</td>
                      <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusStyles[row.status]}`}>{row.status}</span>{result && <div className={`mt-2 text-xs ${result.kind === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{result.kind === 'success' ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{resultLabel(result)}</div>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
            <p className="text-sm text-slate-600">Selected: <strong>{selectedRows.length}</strong> restricted rows</p>
            <button type="button" onClick={() => setConfirming(true)} disabled={selectedRows.length === 0 || working} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Review selected changes</button>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
