import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/admin/AdminLayout';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { supabase } from '../lib/supabase';
import { buildLearnerOverview, computeDashboardMetrics, computeGroupedAnalytics, extractRecurringBehaviorThemes, extractRubricComponentThemes, isAssessed, type AnalyticsRow } from '../lib/analyticsMetrics';

import { downloadAnalyticsWorkbook } from '../lib/analyticsExport';
import { CaseTiming, DomainPerformance, LearnerSummary, PagedRows, RecurringBehaviorThemesPanel, RubricComponentThemes, SafetyReview } from '../components/admin/AnalyticsPanels';

type RawAnalyticsRecord = {
  id: string;
  school_id: string | null;
  is_sandbox: boolean;
  school: { id: string; name: string | null } | null;
  student_id: string;
  room_id: number;
  status: string | null;
  feedback_status: string | null;
  communication_score: number | null;
  mdm_score: number | null;
  grade: number | null;
  created_at: string | null;
  scoring_start_at: string | null;
  case_started_at: string | null;
  safety_result: Record<string, unknown> | null;
  completed_at: string | null;
  feedback_generated_at: string | null;
  case_difficulty: string | null;
  communication_breakdown: Record<string, unknown> | null;
  mdm_breakdown: Record<string, unknown> | null;
  nurse_feedback: Record<string, unknown> | null;
  feedback_debrief: Record<string, unknown> | null;
  student: { id: string; full_name: string | null; role: string | null } | null;
  room: { id: number; room_number: string | null; specialty_id: string | null; specialty_ids: string[] | null } | null;
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
  const [minimumThemeLearners, setMinimumThemeLearners] = useState(3);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [feedbackScope, setFeedbackScope] = useState<'cohort' | 'learner'>('cohort');

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
          id, school_id, is_sandbox, student_id, room_id, status, feedback_status, communication_score, mdm_score,
          grade, created_at, scoring_start_at, case_started_at, safety_result, completed_at, feedback_generated_at, case_difficulty,
          communication_breakdown, mdm_breakdown, nurse_feedback, feedback_debrief,
          student:student_id (id, full_name, role),
          room:room_id (id, room_number, specialty_id, specialty_ids),
          school:school_id (id, name)
        `).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
        if (!includeTest) query = query.eq('is_sandbox', false);
        if (scopedSchoolId) query = query.eq('school_id', scopedSchoolId);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const page = (data ?? []) as unknown as RawAnalyticsRecord[];
        raw.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
        }
        const specialtyIds = [...new Set(raw.flatMap((item) => [item.room?.specialty_id, ...(item.room?.specialty_ids ?? [])]).filter((id): id is string => Boolean(id)))];
        const specialtyMap = new Map<string, string>();
        if (specialtyIds.length) {
          const { data: specialties, error: specialtyError } = await supabase.from('specialties').select('id,name').in('id', specialtyIds);
          if (specialtyError) throw specialtyError;
          (specialties ?? []).forEach((item) => specialtyMap.set(item.id, item.name));
        }
        const mapped: AnalyticsRow[] = raw.map((item) => {
          const room = item.room;
          const ids = [room?.specialty_id, ...(room?.specialty_ids ?? [])].filter((id): id is string => Boolean(id));
          return {
            id: item.id, schoolId: item.school_id, schoolName: item.school?.name ?? null, studentId: item.student_id, studentName: item.student?.full_name ?? 'Unknown learner',
            studentRole: item.student?.role ?? null, roomId: item.room_id, roomNumber: room?.room_number ?? String(item.room_id),
            specialty: ids.map((id: string) => specialtyMap.get(id)).filter(Boolean).join(', ') || 'Unspecified',
            status: item.status, feedbackStatus: item.feedback_status, communicationScore: item.communication_score,
            mdmScore: item.mdm_score,
            overallScore: item.communication_score != null && item.mdm_score != null
              ? Number(((item.communication_score + item.mdm_score) / 2).toFixed(2))
              : null,
            scoringStartAt: item.scoring_start_at, caseStartedAt: item.case_started_at, safetyResult: item.safety_result, createdAt: item.created_at, completedAt: item.completed_at, feedbackGeneratedAt: item.feedback_generated_at,
            caseDifficulty: item.case_difficulty, communicationBreakdown: item.communication_breakdown, mdmBreakdown: item.mdm_breakdown,
            nurseFeedback: item.nurse_feedback,
            feedbackDebrief: item.feedback_debrief,
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
  }, [user, profile, navigate, scopedSchoolId, includeTest]);

  const specialties = useMemo(() => [...new Set(rows.map((row) => row.specialty))].sort(), [rows]);
  const learners = useMemo(() => [...new Map(rows.map((row) => [row.studentId, { id: row.studentId ?? '', name: row.studentName }])).values()].filter((row) => row.id), [rows]);
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
    if (timeScope === 'custom' && toDate && date > toDate) return false;
    return true;
  }), [rows, includeTest, specialty, caseId, status, learnerId, effectiveFromDate, toDate, timeScope]);

  const eligibleLearners = useMemo(() => new Set(filteredRows.map((row) => row.studentId).filter(Boolean)).size, [filteredRows]);
  const metrics = useMemo(() => computeDashboardMetrics(filteredRows, eligibleLearners), [filteredRows, eligibleLearners]);
  const reviewQueue = filteredRows.filter((row) => row.status === 'completed' && row.feedbackStatus !== 'completed').slice(0, 12);
  const maxTrend = Math.max(1, ...metrics.trend.map((point) => point.attempts));
  const feedbackRows = feedbackScope === 'learner' && learnerId !== 'all' ? filteredRows.filter((row) => row.studentId === learnerId) : feedbackScope === 'learner' ? [] : filteredRows;
  const assessedFeedbackRows = feedbackRows.filter(isAssessed);
  const rubricThemes = useMemo(() => extractRubricComponentThemes(assessedFeedbackRows, feedbackScope === 'cohort' ? minimumThemeLearners : 1), [assessedFeedbackRows, feedbackScope, minimumThemeLearners]);

  const learnerOverview = useMemo(() => learnerId === 'all' ? null : buildLearnerOverview(filteredRows.filter((row) => row.studentId === learnerId)), [filteredRows, learnerId]);
  const learnerName = learnerId === 'all' ? '' : rows.find((row) => row.studentId === learnerId)?.studentName ?? 'Selected learner';
  const behaviorThemes = useMemo(() => extractRecurringBehaviorThemes(assessedFeedbackRows, feedbackScope === 'cohort' ? minimumThemeLearners : 1), [assessedFeedbackRows, feedbackScope, minimumThemeLearners]);

  const exportExcel = async () => {
    setExporting(true); setExportError(null);
    try {
      await downloadAnalyticsWorkbook(filteredRows, `School: ${scopedSchoolId ?? 'all authorized schools'}; specialty: ${specialty}; case: ${caseId}; learner: ${learnerId}; status: ${status}; dates: ${effectiveFromDate || 'all'} to ${timeScope === 'custom' ? toDate || 'all' : 'today'}; test/sandbox included: ${includeTest}`);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'Excel export failed. Please try again.');
    } finally { setExporting(false); }
  };

  if (!user || !hasAdminAccess(profile)) return null;

  return <AdminLayout>
    <div className="space-y-6 px-6 py-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Educator workspace</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Analytics & review</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Observed simulation performance and feedback coverage—not a certification or validated measure of clinical competence.</p></div>
          <div className="flex gap-2"><button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />Refresh</button><button onClick={exportExcel} disabled={!filteredRows.length || exporting} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? 'Preparing Excel…' : 'Download Excel'}</button></div>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-4"><SchoolScopeSelector className="min-w-48" /><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setTimeScope('custom'); }} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setTimeScope('custom'); }} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Specialty<select value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All specialties</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Case<select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All cases</option>{cases.map((item) => <option key={item.id} value={item.id}>Room {item.name}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All statuses</option>{['assigned','in_progress','completed','cancelled'].map((item) => <option key={item}>{item.replace('_', ' ')}</option>)}</select></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Learner<select value={learnerId} onChange={(e) => setLearnerId(e.target.value)} className="mt-1 block max-w-52 rounded-md border border-slate-200 px-3 py-2 text-sm"><option value="all">All learners</option>{learners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="flex items-center gap-2 pb-2 text-sm text-slate-600"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Include test/sandbox data</label></div>
        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{includeTest ? 'Test/sandbox data included by explicit choice.' : 'Test/sandbox data excluded from aggregates by default.'} Filters apply to every metric, table, safety review, and Excel download. Cancelled assignments are excluded from completion and performance metrics; missing scores are not zero.</div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Time scope</span>{[['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['1y', 'Last year'], ['all', 'All time'], ['custom', 'Custom']].map(([value, label]) => <button key={value} type="button" onClick={() => setTimeScope(value as typeof timeScope)} className={`rounded-md px-3 py-2 text-sm ${timeScope === value ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{label}</button>)}<span className="ml-auto text-xs text-slate-600">{timeScope === 'all' ? 'All historical activity' : timeScope === 'custom' ? `${fromDate || '—'} to ${toDate || '—'}` : `Since ${effectiveFromDate}`}</span></div>
      </section>

      {exportError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{exportError}</p>}
      <div className="flex justify-end print:hidden"><button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">Print current view</button></div>
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-600"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-2">Loading authorized analytics…</p></div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div> : !filteredRows.length ? <EmptyState /> : <>
        <section className="grid gap-4 md:grid-cols-2">{[
          ['Completed / assigned', `${metrics.completedAssignments} / ${metrics.eligibleAssignments}`, `${pct(metrics.completionRate)} completed · ${metrics.participatingLearners} of ${metrics.eligibleLearners} learners participating`],
          ['Completed with feedback', `${metrics.assessedAssignments} / ${metrics.completedAssignments}`, `${pct(metrics.assessmentCoverageRate)} of completed attempts have saved feedback`],
        ].map(([label, value, detail]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}</section>
        <SafetyReview rows={filteredRows} onOpen={(id) => navigate(`/assignment/${id}`)} />
        <DomainPerformance metrics={metrics} />
        <Panel title="Selected learner summary" subtitle="Strengths and next practice goals taken from this learner's saved evaluations, with links to the source case and evaluation.">{learnerOverview ? <LearnerSummary overview={learnerOverview} learnerName={learnerName} onOpen={(path) => navigate(`/assignment/${path}`)} /> : <p className="text-sm text-slate-600">Choose a learner in the filters to see their summary.</p>}</Panel>
        <Panel title="Completion time by case" subtitle="Complete − Start, pauses included. Valid n counts attempts with both timestamps; completed n counts all completed attempts."><CaseTiming metrics={metrics} /></Panel>
        <details className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-slate-900">Recurring themes and component evidence</summary>
          <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setFeedbackScope('cohort')} className={`rounded-md px-3 py-1.5 text-xs font-medium ${feedbackScope === 'cohort' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Cohort themes</button><button type="button" disabled={learnerId === 'all'} onClick={() => setFeedbackScope('learner')} className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${feedbackScope === 'learner' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Selected learner</button><span className="text-xs text-slate-500">{feedbackScope === 'learner' ? learnerId === 'all' ? 'Choose a learner first.' : `${assessedFeedbackRows.length} selected-learner assessed attempt${assessedFeedbackRows.length === 1 ? '' : 's'}` : `${assessedFeedbackRows.length} assessed/cohort-filtered attempt${assessedFeedbackRows.length === 1 ? '' : 's'}`}</span></div>
          {feedbackScope === 'cohort' && <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">Minimum learners per theme<select aria-label="Minimum learners per theme" value={minimumThemeLearners} onChange={(event) => setMinimumThemeLearners(Number(event.target.value))} className="rounded border px-2 py-1"><option value={3}>3 learners</option><option value={5}>5 learners</option></select></label>}
          <RecurringBehaviorThemesPanel themes={behaviorThemes} />
          <h3 className="mt-4 text-sm font-semibold text-slate-900">Component evidence</h3>
          <RubricComponentThemes themes={rubricThemes} scope={feedbackScope} minimumLearners={feedbackScope === 'cohort' ? minimumThemeLearners : 1} onOpen={(id) => navigate(`/assignment/${id}`)} />
        </details>
        <Panel title="Excel download" subtitle="The workbook uses exactly the filters above and the same timing, summary, and score calculations as this page, including every case and learner attempt."><button onClick={exportExcel} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? 'Preparing Excel…' : 'Download case and learner Excel'}</button></Panel>
        <details className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-slate-900">Activity trends and cohort comparison</summary><div className="mt-4 space-y-5"><Panel title="Attempts over time" subtitle="Assignment activity, not time-on-task."><PagedRows rows={metrics.trend} label="activity dates">{(dates) => <div className="space-y-3">{dates.map((point) => <div key={point.label} className="grid grid-cols-[7rem_1fr_8rem] items-center gap-3 text-sm"><span>{point.label}</span><div className="h-5 rounded bg-slate-100"><div className="h-5 rounded bg-blue-500" style={{ width: `${(point.attempts / maxTrend) * 100}%` }} /></div><span className="text-right text-xs text-slate-600">{point.completed}/{point.attempts} complete</span></div>)}</div>}</PagedRows></Panel>
        <GroupedTable rows={filteredRows} groupBy="specialty" />
        {isSuperAdmin(profile) && <GroupedTable rows={filteredRows} groupBy="school" />}</div></details>
        <details className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-slate-900">Feedback processing review ({reviewQueue.length}{reviewQueue.length === 12 ? '+' : ''})</summary><div className="mt-3 space-y-2">{reviewQueue.length ? reviewQueue.map((row) => <button key={row.id} onClick={() => navigate(`/assignment/${row.id}`)} className="block w-full rounded border p-3 text-left text-sm text-blue-700">{row.studentName} · Room {row.roomNumber} · Feedback {row.feedbackStatus ?? 'missing'}</button>) : <p className="text-sm text-slate-600">No completed attempts currently need feedback review.</p>}</div></details>
        <details className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-slate-900">Learner attempts and evidence links ({filteredRows.length})</summary><div className="mt-3"><button onClick={exportExcel} disabled={exporting} className="mb-4 rounded-lg border px-3 py-2 text-sm text-blue-700 disabled:opacity-50">Download learner attempts in Excel</button><PagedRows rows={filteredRows} label="learner attempts" pageSize={25}>{(page) => <LearnerTable rows={page} navigate={navigate} />}</PagedRows></div></details>
      </>}
    </div>
  </AdminLayout>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p><div className="mt-4">{children}</div></section>; }
function EmptyState() { return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center"><FileText className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-semibold text-slate-900">No authorized attempts match these filters</h2><p className="mt-1 text-sm text-slate-600">Try widening the date or case filters. Missing data is shown as unavailable, not as zero.</p></div>; }
function LearnerTable({ rows, navigate }: { rows: AnalyticsRow[]; navigate: ReturnType<typeof useNavigate> }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Learner attempts and evidence links</h2><p className="mt-1 text-xs text-slate-500">Open the source assignment for transcript, EMR activity, note, completion, and feedback evidence captured for that attempt.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Learner</th><th>Case</th><th>Status</th><th>Feedback</th><th>Domains</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="py-3 font-medium">{row.studentName}</td><td>Room {row.roomNumber}<span className="block text-xs text-slate-500">{row.specialty}</span></td><td>{row.status ?? 'unknown'}</td><td>{row.feedbackStatus ?? 'missing'}</td><td>{row.communicationScore ?? '—'} / {row.mdmScore ?? '—'}</td><td><button onClick={() => navigate(`/assignment/${row.id}`)} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><ExternalLink className="h-3 w-3" />Open evidence</button></td></tr>)}</tbody></table></div></section>; }
function GroupedTable({ rows, groupBy }: { rows: AnalyticsRow[]; groupBy: 'school' | 'specialty' }) {
  const groups = [...computeGroupedAnalytics(rows, groupBy).entries()];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">{groupBy === 'school' ? 'School participation' : 'Specialty / cohort comparison'}</h2><p className="mt-1 text-xs text-slate-500">{groupBy === 'school' ? 'School IDs are shown only when the Super Admin explicitly selects All schools.' : 'Specialty is the available cohort dimension today; cohort, rotation, and training-stage fields are not stored. Scores are shown with coverage, not as a leaderboard.'}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Group</th><th>Attempts</th><th>Completed</th><th>Assessed</th><th>Communication</th><th>Clinical Reasoning</th></tr></thead><tbody>{groups.map(([name, value]) => <tr key={name} className="border-b last:border-0"><td className="py-3 font-medium">{name}</td><td>{value.attempts}</td><td>{value.completed} / {value.attempts}</td><td>{value.assessed} / {value.completed}</td><td>{value.communication.length ? `${(value.communication.reduce((a, b) => a + b, 0) / value.communication.length).toFixed(2)} / 5 (${value.communication.length})` : '—'}</td><td>{value.mdm.length ? `${(value.mdm.reduce((a, b) => a + b, 0) / value.mdm.length).toFixed(2)} / 5 (${value.mdm.length})` : '—'}</td></tr>)}</tbody></table></div></section>;
}
