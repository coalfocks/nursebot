import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSchools } from '../../hooks/useSchools';
import { useAuthStore } from '../../stores/authStore';
import { isSuperAdmin } from '../../lib/roles';
import type { Database } from '../../lib/database.types';

type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];

type ExportRow = {
  student_id_hash: string;
  school: string;
  room_id: number;
  communication_score: number | null;
  mdm_score: number | null;
  overall_score: number | null;
  case_difficulty: string | null;
  completed_at: string | null;
  feedback_status: string | null;
};

type AssignmentForExport = Pick<
  AssignmentRow,
  | 'student_id'
  | 'room_id'
  | 'communication_score'
  | 'mdm_score'
  | 'grade'
  | 'case_difficulty'
  | 'completed_at'
  | 'feedback_status'
  | 'school_id'
> & {
  school: { name: string | null } | null;
};

const PAGE_SIZE = 1000;

const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

const defaultStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return formatDateInput(date);
};

const defaultEndDate = () => formatDateInput(new Date());

const toIsoStart = (value: string) => new Date(`${value}T00:00:00.000Z`).toISOString();
const toIsoEnd = (value: string) => new Date(`${value}T23:59:59.999Z`).toISOString();

const hashStudentId = async (value: string) => {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

const toCsvValue = (value: string | number | null) => {
  if (value === null) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsv = (rows: ExportRow[]) => {
  const headers: Array<keyof ExportRow> = [
    'student_id_hash',
    'school',
    'room_id',
    'communication_score',
    'mdm_score',
    'overall_score',
    'case_difficulty',
    'completed_at',
    'feedback_status',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(',')),
  ];

  return lines.join('\n');
};

export default function ExportScoresCard() {
  const { profile, activeSchoolId } = useAuthStore();
  const { schools } = useSchools();
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const superAdmin = isSuperAdmin(profile);
  const scopedSchoolId = superAdmin ? activeSchoolId : profile?.school_id ?? null;

  const availableSchools = useMemo(() => {
    if (!superAdmin) {
      return schools.filter((school) => school.id === scopedSchoolId);
    }
    if (!scopedSchoolId) return schools;
    return schools.filter((school) => school.id === scopedSchoolId);
  }, [schools, superAdmin, scopedSchoolId]);

  const selectedSchoolId = useMemo(() => {
    if (!superAdmin) return scopedSchoolId;
    if (schoolFilter !== 'all') return schoolFilter;
    return scopedSchoolId ?? null;
  }, [superAdmin, schoolFilter, scopedSchoolId]);

  const downloadCsv = (csv: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const filename = `student_scores_${startDate}_to_${endDate}.csv`;
    anchor.href = url;
    anchor.setAttribute('download', filename);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const loadAssignments = async () => {
    const rows: AssignmentForExport[] = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from('student_room_assignments')
        .select(`
          student_id,
          room_id,
          communication_score,
          mdm_score,
          grade,
          case_difficulty,
          completed_at,
          feedback_status,
          school_id,
          school:school_id ( name )
        `)
        .in('status', ['completed', 'bedside'])
        .gte('completed_at', toIsoStart(startDate))
        .lte('completed_at', toIsoEnd(endDate))
        .order('completed_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (selectedSchoolId) {
        query = query.eq('school_id', selectedSchoolId);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;

      const page = (data ?? []) as AssignmentForExport[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return rows;
  };

  const handleExport = async () => {
    if (!startDate || !endDate) {
      setError('Choose a valid start and end date.');
      return;
    }

    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      setError('Start date must be on or before end date.');
      return;
    }

    setLoading(true);
    setStatus(null);
    setError(null);

    try {
      const assignments = await loadAssignments();
      const exportRows: ExportRow[] = await Promise.all(
        assignments.map(async (row) => ({
          student_id_hash: await hashStudentId(row.student_id),
          school: row.school?.name ?? row.school_id ?? 'Unknown',
          room_id: row.room_id,
          communication_score: row.communication_score,
          mdm_score: row.mdm_score,
          overall_score: row.grade,
          case_difficulty: row.case_difficulty,
          completed_at: row.completed_at,
          feedback_status: row.feedback_status,
        })),
      );

      const csv = buildCsv(exportRows);
      downloadCsv(csv);
      setStatus(`Exported ${exportRows.length} score row${exportRows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('Failed to export student scores', err);
      setError(err instanceof Error ? err.message : 'Unable to export student scores.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Export Scores</h2>
          <p className="text-sm text-slate-500">
            Download anonymized student case scores as CSV within a selected completion window.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Start date</span>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">End date</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">School</span>
            <select
              value={superAdmin ? schoolFilter : (scopedSchoolId ?? 'all')}
              onChange={(event) => setSchoolFilter(event.target.value)}
              disabled={!superAdmin}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {superAdmin && !scopedSchoolId && <option value="all">All schools</option>}
              {availableSchools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={loading}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </>
              )}
            </button>
          </div>
        </div>

        {status && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {status}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
