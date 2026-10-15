import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/admin/AdminLayout';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { computeDashboardMetrics, formatCompletionDuration, type AnalyticsRow } from '../lib/analyticsMetrics';

type RawAnalyticsRecord = {
  id: string;
  school_id: string | null;
  student_id: string;
  room_id: number;
  status: string | null;
  feedback_status: string | null;
  communication_score: number | null;
  mdm_score: number | null;
  grade: number | null;
  created_at: string | null;
  completed_at: string | null;
  feedback_generated_at: string | null;
  case_difficulty: string | null;
  communication_breakdown: Record<string, unknown> | null;
  mdm_breakdown: Record<string, unknown> | null;
  nurse_feedback: Record<string, unknown> | null;
  student: { id: string; full_name: string | null; role: string | null } | null;
  room: { id: number; room_number: string | null; specialty_id: string | null; specialty_ids: string[] | null } | null;
};

const csvEscape = (value: unknown) => {
  const text = value == null ? '' : String(value).replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
};

const pct = (value: number | null) => value == null ? '—' : `${value}%`;

export default function AdminAnalytics() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [specialty, setSpecialty] = useState('all');
  const [caseId, setCaseId] = useState('all');
  const [status, setStatus] = useState('all');
  const [learnerId, setLearnerId] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [timeScope, setTimeScope] = useState<'all' | '3m' | '6m' | '1y' | 'custom'>('all');

  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  useEffect(() => {
    if (!user || !hasAdminAccess(profile)) {
      navigate('/dashboard');
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const pageSize = 1000;
        let from = 0;
        const raw: RawAnalyticsRecord[] = [];
        while (true) {
        let query = supabase.from('student_room_assignments').select(`
          id, school_id, student_id, room_id, status, feedback_status, communication_score, mdm_score,
          grade, created_at, completed_at, feedback_generated_at, case_difficulty,
          communication_breakdown, mdm_breakdown, nurse_feedback,
          student:student_id (id, full_name, role),
          room:room_id (id, room_number, specialty_id, specialty_ids)
        `).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
        if (scopedSchoolId) query = query.eq('school_id', scopedSchoolId);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const page = (data ?? []) as unknown as RawAnalyticsRecord[];
        raw.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
        }
        const specialtyIds = [...new Set(raw.flatMap((item) => [item.room?.specialty_id, ...(item.room?.specialty_ids ?? [])]).filter(Boolean))];
        const specialtyMap = new Map<string, string>();
        if (specialtyIds.length) {
          const { data: specialties, error: specialtyError } = await supabase.from('specialties').select('id,name').in('id', specialtyIds);
          if (specialtyError) throw specialtyError;
          (specialties ?? []).forEach((item) => specialtyMap.set(item.id, item.name));
        }
        const mapped: AnalyticsRow[] = raw.map((item) => {
          const room = item.room ?? {};
          const ids = [room.specialty_id, ...(room.specialty_ids ?? [])].filter(Boolean);
          return {
            id: item.id, schoolId: item.school_id, studentId: item.student_id, studentName: item.student?.full_name ?? 'Unknown learner',
            studentRole: item.student?.role ?? null, roomId: item.room_id, roomNumber: room.room_number ?? String(item.room_id),
            specialty: ids.map((id: string) => specialtyMap.get(id)).filter(Boolean).join(', ') || 'Unspecified',
            status: item.status, feedbackStatus: item.feedback_status, communicationScore: item.communication_score,
            mdmScore: item.mdm_score,
            overallScore: item.communication_score != null && item.mdm_score != null
              ? Number(((item.communication_score + item.mdm_score) / 2).toFixed(2))
              : null,
            createdAt: item.created_at, completedAt: item.completed_at, feedbackGeneratedAt: item.feedback_generated_at,
            caseDifficulty: item.case_difficulty, communicationBreakdown: item.communication_breakdown, mdmBreakdown: item.mdm_breakdown,
            nurseFeedback: item.nurse_feedback,
          };
        });
        if (!cancelled) setRows(mapped);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Analytics could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user, profile, navigate, scopedSchoolId]);

  const specialties = useMemo(() => [...new Set(rows.map((row) => row.specialty))].sort(), [rows]);
  const learners = useMemo(() => [...new Map(rows.map((row) => [row.studentId, { id: row.studentId, name: row.studentName }])).values()].filter((row) => row.id), [rows]);
  const cases = useMemo(() => [...new Map(rows.map((row) => [row.roomId, { id: row.roomId, name: row.roomNumber }])).values()], [rows]);

  const effectiveFromDate = timeScope === 'custom' ? fromDate : timeScope === 'all' ? '' : (() => {
    const date = new Date();
    date.setMonth(date.getMonth() - (timeScope === '3m' ? 3 : timeScope === '6m' ? 6 : 12));
    return date.toISOString().slice(0, 10);
  })();
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (!includeTest && row.studentRole === 'test_user') return false;
    if (specialty !== 'all' && row.specialty !== specialty) return false;
    if (caseId !== 'all' && String(row.roomId) !== caseId) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (learnerId !== 'all' && row.studentId !== learnerId) return false;
    const date = (row.completedAt ?? row.createdAt)?.slice(0, 10) ?? '';
    if (effectiveFromDate && date < effectiveFromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
  }), [rows, includeTest, specialty, caseId, status, learnerId, effectiveFromDate, toDate]);

  const eligibleLearners = useMemo(() => new Set(filteredRows.map((row) => row.studentId).filter(Boolean)).size, [filteredRows]);
  const metrics = useMemo(() => computeDashboardMetrics(filteredRows, eligibleLearners), [filteredRows, eligibleLearners]);
  const reviewQueue = filteredRows.filter((row) => row.status === 'completed' && row.feedbackStatus !== 'completed').slice(0, 12);
  const maxTrend = Math.max(1, ...metrics.trend.map((point) => point.attempts));
  const feedbackHighlights = useMemo(() => {
    const strengths = new Set<string>();
    const growth = new Set<string>();
    const collect = (value: unknown, target: Set<string>) => {
      if (!Array.isArray(value)) return;
      value.forEach((item) => {
        if (typeof item === 'string' && item.trim()) target.add(item.trim());
      });
    };
    filteredRows.forEach((row) => {
      const feedback = row.nurseFeedback ?? {};
      collect(feedback.strengths, strengths);
      collect(feedback.areas_for_improvement, growth);
      collect(feedback.recommendations, growth);
      ['communication', 'clinical_reasoning', 'mdm'].forEach((domain) => {
        const section = feedback[domain];
        if (section && typeof section === 'object' && !Array.isArray(section)) {
          collect((section as Record<string, unknown>).strengths, strengths);
          collect((section as Record<string, unknown>).areas_for_improvement, growth);
        }
      });
    });
    return { strengths: [...strengths].slice(0, 8), growth: [...growth].slice(0, 8) };
  }, [filteredRows]);

  const exportCsv = () => {
    const headers = ['assignment_id', 'learner', 'school_id', 'case', 'specialty', 'status', 'created_at', 'completed_at', 'feedback_status', 'communication_score', 'mdm_score', 'overall_score', 'test_data_included'];
    const lines = [headers.join(','), ...filteredRows.map((row) => [row.id, row.studentName, row.schoolId, row.roomNumber, row.specialty, row.status, row.createdAt, row.completedAt, row.feedbackStatus, row.communicationScore, row.mdmScore, row.overallScore, includeTest].map(csvEscape).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `nurse-althea-analytics-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (!user || !hasAdminAccess(profile)) return null;

  return <AdminLayout>
    <div className="space-y-6 px-6 py-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Educator workspace</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Analytics & review</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Observed simulation performance and feedback coverage—not a certification or validated measure of clinical competence.</p></div>
          <div className="flex gap-2"><button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />Refresh</button><button onClick={exportCsv} disabled={!filteredRows.length} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Download className="h-4 w-4" />Export filtered CSV</button></div>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-4"><SchoolScopeSelector className="min-w-48" /><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold uppercase tracking-wide tracking-wide text-slate-500">Specialty<select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All specialties</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Case<select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All cases</option>{cases.map((item) => <option key={item.id} value={item.id}>Room {item.name}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All statuses</option>{['assigned','in_progress','completed','cancelled'].map((item) => <option key={item}>{item.replace('_', ' ')}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Learner<select value={learnerId} onChange={(e) => setLearnerId(e.target.value)} className="mt-1 block max-w-52 rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All learners</option>{learners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="flex items-center gap-2 pb-2 text-sm text-slate-600"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Include test/sandbox data</label></div>
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{includeTest ? 'Test/sandbox data included by explicit choice.' : 'Test/sandbox data excluded from aggregates by default.'} Filters apply to every KPI, table, drilldown, and export.</div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Time scope</span>{[['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['1y', 'Last year'], ['all', 'All time'], ['custom', 'Custom']].map(([value, label]) => <button key={value} type="button" onClick={() => setTimeScope(value as typeof timeScope)} className={`rounded-md px-3 py-2 text-sm ${timeScope === value ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{label}</button>)}<span className="ml-auto text-xs text-slate-600">{timeScope === 'all' ? 'All historical activity' : timeScope === 'custom' ? `${fromDate || '—'} to ${toDate || '—'}` : `Since ${effectiveFromDate}`}</span></div>
      </section>

      <div className="flex justify-end print:hidden"><button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">Print current view</button></div>
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-600"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-2">Loading authorized analytics…</p></div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div> : !filteredRows.length ? <EmptyState /> : <>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{[['Eligible attempts', metrics.eligibleAssignments, `denominator: ${metrics.eligibleAssignments}`], ['Completed', `${metrics.completedAssignments} / ${metrics.eligibleAssignments}`, pct(metrics.completionRate)], ['Assessment coverage', `${metrics.assessedAssignments} / ${metrics.completedAssignments}`, pct(metrics.assessmentCoverageRate)], ['Learners participating', `${metrics.participatingLearners} / ${metrics.eligibleLearners}`, pct(metrics.participationRate)], ['Median completion time', formatCompletionDuration(metrics.medianCompletionMinutes), `${metrics.completionTimeSampleSize} created/completed timestamp pairs`]].map(([label, value, detail]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}</section>
        <div className="grid gap-6 xl:grid-cols-2"><Panel title="Attempts over time" subtitle="Counts use assignment timestamps; this is not time-on-task."><div className="space-y-3">{metrics.trend.map((point) => <div key={point.label} className="grid grid-cols-[7rem_1fr_8rem] items-center gap-3 text-sm"><span>{point.label}</span><div className="h-5 rounded bg-slate-100"><div className="h-5 rounded bg-blue-500" style={{ width: `${(point.attempts / maxTrend) * 100}%` }} title={`${point.attempts} attempts`} /></div><span className="text-right text-xs text-slate-600">{point.completed}/{point.attempts} complete</span></div>)}</div></Panel><Panel title="Domain performance" subtitle="AI-generated rubric scores; coverage shows how much data is available."><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Domain</th><th>Average</th><th>Scored</th><th>Eligible</th></tr></thead><tbody>{metrics.domainPerformance.map((item) => <tr key={item.domain} className="border-b last:border-0"><td className="py-3">{item.domain}</td><td>{item.average ?? '—'} / 5</td><td>{item.scored}</td><td>{item.eligible}</td></tr>)}</tbody></table></Panel><Panel title="Case × performance" subtitle="Distribution-friendly table alternative; averages are not used alone."><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Case</th><th>Attempts</th><th>Completed</th><th>Overall score</th></tr></thead><tbody>{metrics.caseHeatmap.map((item) => <tr key={item.caseLabel} className="border-b last:border-0"><td className="py-3">{item.caseLabel}</td><td>{item.attempts}</td><td>{item.completed}</td><td>{item.average ?? '—'}</td></tr>)}</tbody></table></Panel><Panel title="Review queue" subtitle="Only explicit missing/pending/failed feedback is flagged; no risk labels.">{reviewQueue.length ? <div className="space-y-2">{reviewQueue.map((row) => <button key={row.id} onClick={() => navigate(`/assignment/${row.id}`)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><span><span className="block text-sm font-medium">{row.studentName} · Room {row.roomNumber}</span><span className="block text-xs text-slate-500">Completed, feedback {row.feedbackStatus ?? 'missing'} · evidence review needed</span></span><ExternalLink className="h-4 w-4 text-slate-400" /></button>)}</div> : <p className="text-sm text-slate-600">No completed attempts currently need feedback review.</p>}</Panel></div>
        <LearnerTable rows={filteredRows} navigate={navigate} />
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Learner strengths and growth</h2>
          <p className="mt-1 text-xs text-slate-500">Formative themes from stored feedback in the same scope and date range. Missing narrative evidence is shown as unavailable.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <h3 className="text-sm font-semibold text-emerald-900">Strengths</h3>
              {feedbackHighlights.strengths.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900">{feedbackHighlights.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-900">Not observed in the selected feedback.</p>}
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">Growth opportunities</h3>
              {feedbackHighlights.growth.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{feedbackHighlights.growth.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-amber-900">Not observed in the selected feedback.</p>}
            </div>
          </div>
        </section>
        <GroupedTable rows={filteredRows} groupBy="specialty" />
        {isSuperAdmin(profile) && <GroupedTable rows={filteredRows} groupBy="school" />}
      </>}
    </div>
  </AdminLayout>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p><div className="mt-4">{children}</div></section>; }
function EmptyState() { return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center"><FileText className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-semibold text-slate-900">No authorized attempts match these filters</h2><p className="mt-1 text-sm text-slate-600">Try widening the date or case filters. Missing data is shown as unavailable, not as zero.</p></div>; }
function LearnerTable({ rows, navigate }: { rows: AnalyticsRow[]; navigate: ReturnType<typeof useNavigate> }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Learner attempts and evidence links</h2><p className="mt-1 text-xs text-slate-500">Open the source assignment for transcript, EMR activity, note, completion, and feedback evidence captured for that attempt.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Learner</th><th>Case</th><th>Status</th><th>Feedback</th><th>Domains</th><th>Source</th></tr></thead><tbody>{rows.slice(0, 100).map((row) => <tr key={row.id} className="border-b last:border-0"><td className="py-3 font-medium">{row.studentName}</td><td>Room {row.roomNumber}<span className="block text-xs text-slate-500">{row.specialty}</span></td><td>{row.status ?? 'unknown'}</td><td>{row.feedbackStatus ?? 'missing'}</td><td>{row.communicationScore ?? '—'} / {row.mdmScore ?? '—'}</td><td><button onClick={() => navigate(`/assignment/${row.id}`)} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><ExternalLink className="h-3 w-3" />Open evidence</button></td></tr>)}</tbody></table></div></section>; }
function GroupedTable({ rows, groupBy }: { rows: AnalyticsRow[]; groupBy: 'school' | 'specialty' }) {
  const groups = [...rows.reduce((map, row) => {
    const key = groupBy === 'school' ? row.schoolId ?? 'Unknown school' : row.specialty;
    const current = map.get(key) ?? { attempts: 0, completed: 0, assessed: 0, communication: [] as number[], mdm: [] as number[] };
    current.attempts += 1;
    if (row.status === 'completed') current.completed += 1;
    if (row.status === 'completed' && row.feedbackStatus === 'completed') current.assessed += 1;
    if (typeof row.communicationScore === 'number') current.communication.push(row.communicationScore);
    if (typeof row.mdmScore === 'number') current.mdm.push(row.mdmScore);
    map.set(key, current);
    return map;
  }, new Map<string, { attempts: number; completed: number; assessed: number; communication: number[]; mdm: number[] }>()).entries()];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{groupBy === 'school' ? 'School participation' : 'Specialty / cohort comparison'}</h2><p className="mt-1 text-xs text-slate-500">{groupBy === 'school' ? 'School IDs are shown only when the Super Admin explicitly selects All schools.' : 'Specialty is the available cohort dimension today; cohort, rotation, and training-stage fields are not stored. Scores are shown with coverage, not as a leaderboard.'}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Group</th><th>Attempts</th><th>Completed</th><th>Assessed</th><th>Communication</th><th>MDM</th></tr></thead><tbody>{groups.map(([name, value]) => <tr key={name} className="border-b last:border-0"><td className="py-3 font-medium">{name}</td><td>{value.attempts}</td><td>{value.completed} / {value.attempts}</td><td>{value.assessed} / {value.completed}</td><td>{value.communication.length ? `${(value.communication.reduce((a, b) => a + b, 0) / value.communication.length).toFixed(2)} / 5 (${value.communication.length})` : '—'}</td><td>{value.mdm.length ? `${(value.mdm.reduce((a, b) => a + b, 0) / value.mdm.length).toFixed(2)} / 5 (${value.mdm.length})` : '—'}</td></tr>)}</tbody></table></div></section>;
}
