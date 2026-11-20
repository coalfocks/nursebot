import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CASE_TIMING_EXCLUSION_LABELS, formatCompletionDuration, safetyFlagFor, type AnalyticsRow, type CaseTimingExclusion, type DashboardMetrics, type LearnerOverview, type RecurringBehaviorThemes, type RubricComponentTheme, type SavedComment } from '../../lib/analyticsMetrics';

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

const stamp = (value: string | null) => value ? value.replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, ' UTC').replace(/\+00:00$/, ' UTC') : '—';

export function CaseTiming({ metrics }: Props) {
  const { caseTiming } = metrics;
  const excluded = (Object.keys(caseTiming.exclusions) as CaseTimingExclusion[]).filter((key) => caseTiming.exclusions[key] > 0);
  return <div><p className="mb-1 text-sm text-slate-600">Elapsed time = Complete − Start (first case open), including pauses. The first nurse page is a separate field that only marks where scoring begins. Average {formatCompletionDuration(caseTiming.averageMinutes)} · median {formatCompletionDuration(caseTiming.medianMinutes)} · valid n = {caseTiming.validSamples} · completed n = {caseTiming.completedAttempts}.</p>
    {excluded.length > 0 && <ul className="mb-3 list-disc pl-5 text-xs text-amber-800">{excluded.map((key) => <li key={key}>{caseTiming.exclusions[key]} excluded: {CASE_TIMING_EXCLUSION_LABELS[key]}</li>)}</ul>}
    <PagedRows rows={metrics.caseHeatmap} label="case timings">{(cases) => <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Case</th><th>Average elapsed</th><th>Median elapsed</th><th>Valid n / completed n</th></tr></thead><tbody>{cases.map((item) => <tr key={item.roomId} className="border-b last:border-0"><td className="py-3">Room {item.caseLabel}<span className="block text-xs text-slate-500">{item.specialty} · {item.schoolName}</span></td><td>{formatCompletionDuration(item.averageCompletionMinutes)}</td><td>{formatCompletionDuration(item.medianCompletionMinutes)}</td><td>{item.completionTimeSampleSize} / {item.completed}</td></tr>)}</tbody></table></div>}</PagedRows>
    <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">Timing by attempt ({caseTiming.attempts.length})</summary>
      <div className="mt-3"><PagedRows rows={caseTiming.attempts} label="timing attempts" pageSize={25}>{(page) => <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">Learner</th><th>Case</th><th>Start (first case open)</th><th>Complete</th><th>Duration</th><th>Exclusion reason</th></tr></thead><tbody>{page.map((attempt) => <tr key={attempt.assignmentId} className="border-b last:border-0"><td className="py-2">{attempt.studentName}</td><td>Room {attempt.caseLabel}</td><td>{stamp(attempt.start)}</td><td>{stamp(attempt.complete)}</td><td>{attempt.minutes == null ? '—' : formatCompletionDuration(attempt.minutes)}</td><td className="text-xs text-amber-800">{attempt.exclusionReason ?? ''}</td></tr>)}</tbody></table></div>}</PagedRows></div>
    </details>
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
    <p className="mt-3 text-xs text-slate-600">Grouped by rubric component. Counts are distinct learners with a valid structured score. A shared component tag is component evidence only; it is not a recurring strength or need.</p>
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
        {attempt.explanation ? <p className="mt-1 text-xs text-slate-700">{attempt.explanation}</p> : <p className="mt-1 text-xs text-slate-500">No saved explanation for this component.</p>}
        <p className="mt-1 text-xs text-slate-500">Evidence: {attempt.evidenceIds.length ? attempt.evidenceIds.join(', ') : 'none recorded'}</p>
      </li>)}</ul>
      {theme.taggedComments.length > 0
        ? <div className="mt-3 border-t pt-2"><p className="text-xs font-medium text-slate-700">Component evidence: {theme.taggedComments.length} saved comment{theme.taggedComments.length === 1 ? '' : 's'} tagged to this component (not a recurring theme)</p><ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{theme.taggedComments.map((comment) => <li key={`${comment.assignmentId}-${comment.kind}-${comment.text}`}>{comment.studentName}: {comment.text} <span className="text-slate-500">(evidence: {comment.evidenceIds.join(', ')})</span></li>)}</ul></div>
        : <p className="mt-3 border-t pt-2 text-xs text-slate-500">No saved comments are tagged to this component.</p>}
    </details>)}
  </div>;
}

const dateLabel = (value: string | null) => value ? value.slice(0, 10) : '—';

function CommentList({ comments, onOpen, empty }: { comments: SavedComment[]; onOpen: (id: string) => void; empty: string }) {
  if (!comments.length) return <p className="mt-1 text-xs text-slate-500">{empty}</p>;
  return <ul className="mt-1 space-y-2">{comments.map((comment, index) => <li key={`${comment.assignmentId}-${comment.kind}-${index}`} className="text-sm text-slate-800">
    <span>{comment.text}</span>
    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{comment.componentKeys.length ? comment.componentKeys.join(', ') : comment.source === 'legacy_evaluation_feedback' ? 'Saved evaluation feedback (legacy)' : 'Evaluation feedback'}</span>
    <span className="block text-xs text-slate-500">Room {comment.caseLabel} · {dateLabel(comment.at)} · {comment.evidenceIds.length ? `evidence: ${comment.evidenceIds.join(', ')}` : 'no linked evidence'} · <button type="button" onClick={() => onOpen(comment.assignmentId)} className="text-blue-700 hover:underline">Open case</button> · <button type="button" onClick={() => onOpen(`${comment.assignmentId}/feedback`)} className="text-blue-700 hover:underline">Open evaluation</button></span>
  </li>)}</ul>;
}

export function LearnerSummary({ overview, learnerName, onOpen }: { overview: LearnerOverview; learnerName: string; onOpen: (path: string) => void }) {
  if (overview.evaluatedCases === 0) return <p className="text-sm text-slate-600">{learnerName} has no evaluated cases in this scope, so there is nothing to summarize yet.</p>;
  return <div className="space-y-4">
    <p className="text-sm text-slate-700"><strong>{learnerName}</strong> · {overview.evaluatedCases} evaluated case{overview.evaluatedCases === 1 ? '' : 's'} · {overview.firstDate === overview.lastDate ? dateLabel(overview.firstDate) : `${dateLabel(overview.firstDate)} to ${dateLabel(overview.lastDate)}`}{overview.basedOnOneEvaluation && <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Based on one evaluation</span>}</p>
    <p className="text-xs text-slate-500">Built from saved evaluation strengths, improvements, and component explanations; no new model calls. No cohort minimum applies to a single learner.</p>
    <div><h3 className="text-sm font-semibold text-slate-900">Supported strengths</h3><CommentList comments={overview.strengths} onOpen={onOpen} empty="No evidence-linked strengths were saved." /></div>
    <div><h3 className="text-sm font-semibold text-slate-900">Next practice goals</h3><CommentList comments={overview.nextPractice} onOpen={onOpen} empty="No specific next practice goals were saved." /></div>
    {overview.unsupported.length > 0 && <div><h3 className="text-sm font-semibold text-slate-900">Saved evaluation feedback (no linked event IDs)</h3><CommentList comments={overview.unsupported} onOpen={onOpen} empty="" /></div>}
    <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">Component explanations by case</summary>
      <div className="mt-3 space-y-3">{overview.components.map((component) => <div key={component.key}><h4 className="text-sm font-medium">{component.label} <span className="text-xs text-slate-500">{component.domain} · {component.min} to {component.max}</span></h4>
        {component.entries.length ? <ul className="mt-1 space-y-1">{component.entries.map((entry) => <li key={entry.assignmentId} className="text-xs text-slate-700">Room {entry.caseLabel} · score {entry.score}: {entry.explanation ?? 'No saved explanation for this component.'} <button type="button" onClick={() => onOpen(entry.assignmentId)} className="text-blue-700 hover:underline">Open case</button> · <button type="button" onClick={() => onOpen(`${entry.assignmentId}/feedback`)} className="text-blue-700 hover:underline">Open evaluation</button></li>)}</ul> : <p className="text-xs text-slate-500">No structured score for this component.</p>}
        {component.taggedComments.length > 0 && <p className="mt-1 text-xs text-slate-500">{component.taggedComments.length} saved comment{component.taggedComments.length === 1 ? '' : 's'} tagged to this component (listed above).</p>}
      </div>)}</div>
    </details>
    {overview.evaluationFeedback.length > 0 && <p className="text-xs text-slate-500">{overview.evaluationFeedback.length} older comment{overview.evaluationFeedback.length === 1 ? ' has' : 's have'} no component tag and {overview.evaluationFeedback.length === 1 ? 'is' : 'are'} labeled “Evaluation feedback” above; they are not attached to any skill.</p>}
  </div>;
}

export function RecurringBehaviorThemesPanel({ themes }: { themes: RecurringBehaviorThemes }) {
  const list = (items: RecurringBehaviorThemes['recurringStrengths'], title: string, empty: string) => <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{items.length
    ? <ul className="mt-1 space-y-2">{items.map((theme) => <li key={`${theme.direction}-${theme.behaviorKey}`} className="text-sm"><span className="font-medium">{theme.behaviorKey}</span> · {theme.learners} learners<ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{theme.comments.map((comment, i) => <li key={`${comment.assignmentId}-${i}`}>{comment.studentName}: {comment.text} <span className="text-slate-500">(evidence: {comment.evidenceIds.join(', ')})</span></li>)}</ul></li>)}</ul>
    : <p className="mt-1 text-xs text-slate-500">{empty}</p>}</div>;
  return <div className="mt-3 space-y-3">
    <p className="text-xs text-slate-600">A recurring strength or need is the same behavior in the same direction for at least {themes.minimumLearners} distinct known learners (selectable: 3 or 5). Component tags alone never qualify.</p>
    {themes.keyedComments === 0 && <p className="rounded bg-slate-50 p-2 text-xs text-slate-700">No stable behavior keys have been saved on any comment in this scope (the feedback generator does not emit them yet), so no recurring strength or need can be claimed. Component evidence is shown below.</p>}
    {list(themes.recurringStrengths, 'Recurring strengths', `No behavior meets the ${themes.minimumLearners}-learner minimum as a strength.`)}
    {list(themes.recurringNeeds, 'Recurring needs', `No behavior meets the ${themes.minimumLearners}-learner minimum as an improvement need.`)}
    {themes.belowThreshold.length > 0 && <p className="text-xs text-slate-500">Below threshold, not claimed: {themes.belowThreshold.map((theme) => `${theme.behaviorKey} (${theme.direction}, n = ${theme.learners})`).join('; ')}.</p>}
  </div>;
}
