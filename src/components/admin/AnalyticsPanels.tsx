import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatCompletionDuration, safetyFlagFor, type AnalyticsRow, type DashboardMetrics } from '../../lib/analyticsMetrics';

type Props = { metrics: DashboardMetrics };
export function DomainPerformance({ metrics }: Props) {
  return <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-900">Domain performance and subscores</h2>
    <p className="mt-1 text-sm text-slate-600">Averages use completed attempts with saved feedback. Each row shows its scored sample; missing values are not treated as zero.</p>
    <div className="mt-4 grid gap-5 lg:grid-cols-2">{metrics.domainPerformance.map((domain) => <div key={domain.domain} className="rounded-xl border border-slate-200 p-4">
      <h3 className="flex justify-between font-semibold">{domain.domain}<span className="text-blue-700">{domain.average ?? '—'} / 5</span></h3>
      <p className="mt-1 text-xs text-slate-500">{domain.scored} scored / {domain.eligible} completed attempts</p>
      <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Component</th><th>Average</th><th>Scored</th></tr></thead><tbody>
        {metrics.subscorePerformance.filter((item) => item.domain === domain.domain).map((item) => <tr key={item.label} className="border-b last:border-0"><td className="py-3 pr-2">{item.label}<span className="block text-xs text-slate-500">{item.min} to {item.max}</span></td><td>{item.average ?? '—'}</td><td>{item.scored}</td></tr>)}
      </tbody></table>
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
  return <div><p className="mb-3 text-sm text-slate-600">First recorded nurse page to completion, including pauses—not active time. {metrics.completionTimeSampleSize} of {metrics.completedAssignments} completed attempts have valid timing data; older attempts without a recorded start are excluded.</p>
    <PagedRows rows={metrics.caseHeatmap} label="case timings">{(cases) => <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Case</th><th>Median elapsed</th><th>Valid timings / completed</th></tr></thead><tbody>{cases.map((item) => <tr key={item.roomId} className="border-b last:border-0"><td className="py-3">Room {item.caseLabel}<span className="block text-xs text-slate-500">{item.specialty} · {item.schoolName}</span></td><td>{formatCompletionDuration(item.medianCompletionMinutes)}</td><td>{item.completionTimeSampleSize} / {item.completed}</td></tr>)}</tbody></table></div>}</PagedRows>
  </div>;
}

export function SafetyReview({ rows, onOpen }: { rows: AnalyticsRow[]; onOpen: (id: string) => void }) {
  const flags = rows.filter((row) => row.status === 'completed' && safetyFlagFor(row)).sort((a, b) => Number(safetyFlagFor(b)?.level === 'critical') - Number(safetyFlagFor(a)?.level === 'critical') || a.studentName.localeCompare(b.studentName));
  return <section className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
    <h2 className="font-semibold text-slate-900">Safety flags for faculty review</h2>
    <p className="mt-1 text-xs text-slate-600">{flags.length} flagged attempts in this scope. Explicit saved safety flags from simulated cases; critical flags appear first.</p>
    {flags.length ? <div className="mt-4"><PagedRows rows={flags} label="safety flags">{(page) => <ul className="space-y-3">{page.map((row) => { const flag = safetyFlagFor(row)!; return <li key={row.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold">{row.studentName} · Room {row.roomNumber}<span className="ml-2 rounded bg-white px-2 py-1 text-xs uppercase">{flag.level}</span></h3><button onClick={() => onOpen(row.id)} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">Review attempt <ExternalLink className="h-3 w-3" /></button></div><p className="mt-2 whitespace-pre-wrap text-sm">{flag.rationale}</p>{flag.action && <p className="mt-1 text-xs text-slate-600">Recorded action: {flag.action}</p>}</li>; })}</ul>}</PagedRows></div> : <p className="mt-4 text-sm text-slate-600">No recorded concern or critical safety flags in this scope.</p>}
  </section>;
}
