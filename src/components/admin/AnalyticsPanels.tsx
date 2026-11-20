import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CASE_TIMING_EXCLUSION_LABELS, formatCompletionDuration, safetyFlagFor, type AnalyticsRow, type CaseTimingExclusion, type DashboardMetrics, type RubricComponentTheme } from '../../lib/analyticsMetrics';

type Props = { metrics: DashboardMetrics };
export function DomainPerformance({ metrics }: Props) {
  return <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-900">Domain performance and subscores</h2>
    <p className="mt-1 text-sm text-slate-600">Averages use completed attempts with saved feedback. Each row shows its scored sample; missing values are not treated as zero.</p>
    <div className="mt-4 grid gap-5 lg:grid-cols-2">{metrics.domainPerformance.map((domain) => <div key={domain.domain} className="rounded-xl border border-slate-200 p-4">
      <h3 className="flex justify-between font-semibold">{domain.domain}<span className="text-blue-700">{domain.average ?? '—'} / 5</span></h3>
      <p className="mt-1 text-xs text-slate-500">{domain.scored} scored / {domain.eligible} completed attempts</p>
      <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Component</th><th>Average</th><th>Scored</th></tr></thead><tbody>
        {metrics.subscorePerformance.filter((item) => item.domain === domain.domain).map((item) => <tr key={item.label} className="border-b last:border-0"><td className="py-3 pr-2">{item.label}<span className="block text-xs text-slate-500">{item.min} to {item.max}</span></td><td>{item.scored > 0 ? item.average : <span className="text-xs text-amber-800">Components unavailable</span>}</td><td>{item.scored} of {item.assessed}</td></tr>)}
      </tbody></table>
      {metrics.subscorePerformance.filter((item) => item.domain === domain.domain && item.unavailableReason).slice(0, 1).map((item) => <p key={`${item.label}-reason`} className="mt-2 text-xs text-amber-800">{item.unavailableReason}</p>)}
    </div>)}</div>
    <p className="mt-3 text-xs text-slate-500">Zero efficiency or safety deduction means no deduction. Missing component data is shown as unavailable.</p>
  </section>;
}

export function PagedRows<T>({ rows, children, label, pageSize = 10 }: { rows: T[]; children: (rows: T[]) => React.ReactNode; label: string; pageSize?: number }) {
  const [requestedPage, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  return <>{children(rows.slice(page * pageSize, (page + 1) * pageSize))}{rows.length > pageSize && <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-600"><span>{page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}</span><div className="flex gap-2"><button type="button" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button><button type="button" aria-label={`Next ${label}`} disabled={page === pages - 1} onClick={() => setPage(page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Next</button></div></div>}</>;
}

export function CaseTiming({ metrics }: Props) {
  const { caseTiming } = metrics;
  const excluded = (Object.keys(caseTiming.exclusions) as CaseTimingExclusion[]).filter((key) => caseTiming.exclusions[key] > 0);
  return <div><p className="mb-1 text-sm text-slate-600">Case Start (first opened) to Complete, wall-clock. Average {formatCompletionDuration(metrics.averageCompletionMinutes)} · median {formatCompletionDuration(metrics.medianCompletionMinutes)} · n = {caseTiming.validSamples} of {caseTiming.completedAttempts} completed attempts.</p>
    <p className="mb-3 text-xs text-slate-500">{caseTiming.activeTimeReason}</p>
    {excluded.length > 0 && <ul className="mb-3 list-disc pl-5 text-xs text-amber-800">{excluded.map((key) => <li key={key}>{caseTiming.exclusions[key]} excluded: {CASE_TIMING_EXCLUSION_LABELS[key]}</li>)}</ul>}
    <PagedRows rows={metrics.caseHeatmap} label="case timings">{(cases) => <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Case</th><th>Median elapsed</th><th>Valid timings / completed</th></tr></thead><tbody>{cases.map((item) => <tr key={item.roomId} className="border-b last:border-0"><td className="py-3">Room {item.caseLabel}<span className="block text-xs text-slate-500">{item.specialty} · {item.schoolName}</span></td><td>{formatCompletionDuration(item.medianCompletionMinutes)}</td><td>{item.completionTimeSampleSize} / {item.completed}</td></tr>)}</tbody></table></div>}</PagedRows>
  </div>;
}

export function SafetyReview({ rows, onOpen }: { rows: AnalyticsRow[]; onOpen: (id: string) => void }) {
  const flags = rows.filter((row) => row.status === 'completed' && safetyFlagFor(row)).sort((a, b) => Number(safetyFlagFor(b)?.level === 'critical') - Number(safetyFlagFor(a)?.level === 'critical') || a.studentName.localeCompare(b.studentName));
  return <section className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
    <h2 className="font-semibold text-slate-900">Safety flags for faculty review</h2>
    <p className="mt-1 text-xs text-slate-600">{flags.length} flagged {flags.length === 1 ? 'attempt' : 'attempts'} in this scope. Explicit saved safety flags from simulated cases; critical flags appear first.</p>
    {flags.length ? <div className="mt-4"><PagedRows rows={flags} label="safety flags">{(page) => <ul className="space-y-3">{page.map((row) => { const flag = safetyFlagFor(row)!; return <li key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold">{row.studentName} · Room {row.roomNumber}<span className="ml-2 rounded bg-white px-2 py-1 text-xs uppercase">{flag.level}</span></h3><button onClick={() => onOpen(row.id)} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">Review attempt <ExternalLink className="h-3 w-3" /></button></div><p className="mt-2 whitespace-pre-wrap text-sm">{flag.rationale}</p>{flag.action && <p className="mt-1 text-xs text-slate-600">Recorded action: {flag.action}</p>}</li>; })}</ul>}</PagedRows></div> : <p className="mt-4 text-sm text-slate-600">No recorded concern or critical safety flags in this scope.</p>}
  </section>;
}

export function RubricComponentThemes({ themes, scope, minimumLearners, onOpen }: { themes: RubricComponentTheme[]; scope: 'cohort' | 'learner'; minimumLearners: number; onOpen: (assignmentId: string) => void }) {
  const hasValid = themes.some((theme) => theme.validLearners > 0);
  return <div>
    <p className="mt-3 text-xs text-slate-600">Grouped by rubric component. Counts are distinct learners with a valid structured score. Individual comments are shown in the drill-through, untouched.</p>
    {!hasValid && <p className="mt-3 text-sm text-slate-600">{scope === 'cohort' ? 'No rubric component has structured scores in this scope.' : 'No structured component scores are available for this learner.'}</p>}
    {hasValid && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Component</th><th>Valid n (learners)</th><th>At max</th><th>Below max</th><th>Unavailable attempts</th></tr></thead><tbody>
      {themes.map((theme) => <tr key={theme.key} className="border-b last:border-0"><td className="py-2 pr-2">{theme.label}<span className="block text-xs text-slate-500">{theme.domain} · {theme.min} to {theme.max}</span></td>
        {theme.suppressed
          ? <td colSpan={2} className="text-xs text-slate-600">{theme.validLearners > 0 ? `n = ${theme.validLearners}; below the ${minimumLearners}-learner minimum, counts hidden` : 'No valid scores'}</td>
          : <><td>{theme.validLearners}</td><td>{theme.atMaxLearners}</td><td>{theme.belowMaxLearners}</td></>}
        <td>{theme.unavailableAttempts}</td></tr>)}
    </tbody></table></div>}
    {themes.filter((theme) => theme.attempts.length > 0 && !theme.suppressed).map((theme) => <details key={`${theme.key}-drill`} className="mt-3 rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">{theme.label}: {theme.attempts.length} attempt{theme.attempts.length === 1 ? '' : 's'} (n = {theme.validLearners} learners)</summary>
      <ul className="mt-3 space-y-3">{theme.attempts.map((attempt) => <li key={attempt.assignmentId} className="text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{attempt.studentName} · Room {attempt.caseLabel} · score {attempt.score} ({theme.min} to {theme.max})</span><button type="button" onClick={() => onOpen(attempt.assignmentId)} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">Review attempt <ExternalLink className="h-3 w-3" /></button></div>
        {attempt.comments.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{attempt.comments.map((text) => <li key={text}>{text}</li>)}</ul>}
      </li>)}</ul>
      <p className="mt-2 text-xs text-slate-500">Comments are attempt-level and are not tagged to this component.</p>
    </details>)}
  </div>;
}
